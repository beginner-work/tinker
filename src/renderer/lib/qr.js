/* qr.js — a tiny, zero-dependency QR Code generator (byte mode).
 *
 * Vendored as a self-contained library (like lib/rainbow-web.js) so the
 * renderer can draw a *real, scannable* QR code with no build step and
 * no external request — it satisfies a strict `script-src 'self'` CSP
 * and works the same in the browser, Electron, and Capacitor.
 *
 * Scope, on purpose: byte (8-bit / UTF-8) mode only, automatic version
 * selection (1–10, which covers URLs comfortably), and the four error-
 * correction levels. That's everything the Pitch "back me" link needs;
 * we deliberately leave out numeric/alphanumeric/kanji modes and the
 * larger versions to keep this small and auditable.
 *
 * Algorithm is the standard QR pipeline (ISO/IEC 18004): encode the
 * data segment, append the terminator + pad codewords, compute Reed–
 * Solomon error-correction codewords, interleave blocks, lay the modules
 * out on the matrix with the function patterns, then pick the mask with
 * the lowest penalty and stamp the format/version information.
 *
 * Public API:
 *   window.tinkerQR.toSvg(text, { ecc, margin, scale, dark, light })
 *     → an <svg> string drawing the code.
 *   window.tinkerQR.encode(text, ecc) → { size, modules } (boolean grid)
 *     for callers that want to draw it themselves.
 */
(function (global) {
  "use strict";

  // ── Galois field GF(256) tables for Reed–Solomon ────────────────────
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d; // primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  // Reed–Solomon divisor (generator) polynomial of the given degree.
  // Returns exactly `degree` coefficients — the monic leading term is
  // implicit — so it lines up with the remainder loop below.
  function rsGenerator(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1; // start with the monomial x^0 == 1
    let root = 1;
    for (let i = 0; i < degree; i++) {
      // Multiply the current product by (x - r) where r = 2^i.
      for (let j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 2);
    }
    return result;
  }

  function rsEncode(data, degree) {
    const gen = rsGenerator(degree);
    const res = new Array(degree).fill(0);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ res[0];
      res.shift();
      res.push(0);
      for (let j = 0; j < degree; j++) {
        res[j] ^= gfMul(gen[j], factor);
      }
    }
    return res;
  }

  // ── Capacity / block tables, versions 1–10 ──────────────────────────
  // ECC level order used throughout: L=0, M=1, Q=2, H=3.
  const ECC_LEVELS = { L: 0, M: 1, Q: 2, H: 3 };

  // Total data codewords per (version, ecc).
  // Source: ISO/IEC 18004 capacity tables.
  const DATA_CODEWORDS = [
    // v: [L, M, Q, H]
    null,
    [19, 16, 13, 9],     // 1
    [34, 28, 22, 16],    // 2
    [55, 44, 34, 26],    // 3
    [80, 64, 48, 36],    // 4
    [108, 86, 62, 46],   // 5
    [136, 108, 76, 60],  // 6
    [156, 124, 88, 66],  // 7
    [194, 154, 110, 86], // 8
    [232, 182, 132, 100],// 9
    [274, 216, 154, 122],// 10
  ];

  // EC codewords per block, and block structure: [ecPerBlock,
  // [numBlocksGroup1, dataPerBlockGroup1, numBlocksGroup2, dataPerBlockGroup2]].
  const ECC_BLOCKS = [
    null,
    { 0: [7, [1, 19, 0, 0]], 1: [10, [1, 16, 0, 0]], 2: [13, [1, 13, 0, 0]], 3: [17, [1, 9, 0, 0]] },       // 1
    { 0: [10, [1, 34, 0, 0]], 1: [16, [1, 28, 0, 0]], 2: [22, [1, 22, 0, 0]], 3: [28, [1, 16, 0, 0]] },     // 2
    { 0: [15, [1, 55, 0, 0]], 1: [26, [1, 44, 0, 0]], 2: [18, [2, 17, 0, 0]], 3: [22, [2, 13, 0, 0]] },     // 3
    { 0: [20, [1, 80, 0, 0]], 1: [18, [2, 32, 0, 0]], 2: [26, [2, 24, 0, 0]], 3: [16, [4, 9, 0, 0]] },      // 4
    { 0: [26, [1, 108, 0, 0]], 1: [24, [2, 43, 0, 0]], 2: [18, [2, 15, 2, 16]], 3: [22, [2, 11, 2, 12]] },  // 5
    { 0: [18, [2, 68, 0, 0]], 1: [16, [4, 27, 0, 0]], 2: [24, [4, 19, 0, 0]], 3: [28, [4, 15, 0, 0]] },     // 6
    { 0: [20, [2, 78, 0, 0]], 1: [18, [4, 31, 0, 0]], 2: [18, [2, 14, 4, 15]], 3: [26, [4, 13, 1, 14]] },   // 7
    { 0: [24, [2, 97, 0, 0]], 1: [22, [2, 38, 2, 39]], 2: [22, [4, 18, 2, 19]], 3: [26, [4, 14, 2, 15]] },  // 8
    { 0: [30, [2, 116, 0, 0]], 1: [22, [3, 36, 2, 37]], 2: [20, [4, 16, 4, 17]], 3: [24, [4, 12, 4, 13]] }, // 9
    { 0: [18, [2, 68, 2, 69]], 1: [26, [4, 43, 1, 44]], 2: [24, [6, 19, 2, 20]], 3: [28, [6, 15, 2, 16]] }, // 10
  ];

  // Alignment-pattern centre coordinates per version (none for v1).
  const ALIGN_POS = [
    null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
  ];

  // ── Bit buffer ──────────────────────────────────────────────────────
  function BitBuffer() {
    this.bits = [];
  }
  BitBuffer.prototype.put = function (value, length) {
    for (let i = length - 1; i >= 0; i--) {
      this.bits.push((value >>> i) & 1);
    }
  };
  BitBuffer.prototype.length = function () {
    return this.bits.length;
  };

  function utf8Bytes(str) {
    // TextEncoder is available in every runtime we target.
    return Array.from(new TextEncoder().encode(str));
  }

  function chooseVersion(byteLen, eccIndex) {
    for (let v = 1; v <= 10; v++) {
      // byte-mode: 4-bit mode indicator + char-count indicator
      // (8 bits for v1–9, 16 bits for v10+) + 8 bits per byte.
      const ccBits = v < 10 ? 8 : 16;
      const needBits = 4 + ccBits + byteLen * 8;
      const capacityBits = DATA_CODEWORDS[v][eccIndex] * 8;
      if (needBits <= capacityBits) return v;
    }
    throw new Error("qr: data too long for byte mode (max version 10)");
  }

  function buildDataCodewords(bytes, version, eccIndex) {
    const buf = new BitBuffer();
    buf.put(0b0100, 4); // byte mode indicator
    const ccBits = version < 10 ? 8 : 16;
    buf.put(bytes.length, ccBits);
    for (const b of bytes) buf.put(b, 8);

    const totalDataCodewords = DATA_CODEWORDS[version][eccIndex];
    const capacityBits = totalDataCodewords * 8;

    // Terminator (up to 4 zero bits).
    const remaining = capacityBits - buf.length();
    buf.put(0, Math.min(4, remaining));
    // Pad to a byte boundary.
    while (buf.length() % 8 !== 0) buf.bits.push(0);

    // Pack bits into bytes.
    const codewords = [];
    for (let i = 0; i < buf.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | buf.bits[i + j];
      codewords.push(byte);
    }
    // Pad codewords alternating 0xEC / 0x11.
    const PADS = [0xec, 0x11];
    let p = 0;
    while (codewords.length < totalDataCodewords) {
      codewords.push(PADS[p++ % 2]);
    }
    return codewords;
  }

  // Interleave data + EC codewords across blocks per the spec.
  function buildFinalCodewords(dataCodewords, version, eccIndex) {
    const [ecPerBlock, [g1, d1, g2, d2]] = ECC_BLOCKS[version][eccIndex];

    const blocks = [];
    let pos = 0;
    for (let i = 0; i < g1; i++) {
      const data = dataCodewords.slice(pos, pos + d1);
      pos += d1;
      blocks.push({ data, ec: rsEncode(data, ecPerBlock) });
    }
    for (let i = 0; i < g2; i++) {
      const data = dataCodewords.slice(pos, pos + d2);
      pos += d2;
      blocks.push({ data, ec: rsEncode(data, ecPerBlock) });
    }

    const result = [];
    const maxData = Math.max(d1, d2);
    for (let i = 0; i < maxData; i++) {
      for (const block of blocks) {
        if (i < block.data.length) result.push(block.data[i]);
      }
    }
    for (let i = 0; i < ecPerBlock; i++) {
      for (const block of blocks) result.push(block.ec[i]);
    }
    return result;
  }

  // ── Matrix construction ─────────────────────────────────────────────
  function makeMatrix(size) {
    const m = [];
    for (let r = 0; r < size; r++) m.push(new Array(size).fill(null));
    return m;
  }

  function placeFinder(m, row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = row + r;
        const cc = col + c;
        if (rr < 0 || rr >= m.length || cc < 0 || cc >= m.length) continue;
        const isBorder =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const isCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        m[rr][cc] = isBorder || isCore;
      }
    }
  }

  function placeAlignment(m, version) {
    const positions = ALIGN_POS[version];
    for (const r of positions) {
      for (const c of positions) {
        // Skip the three that collide with finder patterns.
        if (m[r][c] !== null) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const ring = Math.max(Math.abs(dr), Math.abs(dc));
            m[r + dr][c + dc] = ring !== 1;
          }
        }
      }
    }
  }

  function placeTiming(m) {
    const size = m.length;
    for (let i = 8; i < size - 8; i++) {
      const v = i % 2 === 0;
      if (m[6][i] === null) m[6][i] = v;
      if (m[i][6] === null) m[i][6] = v;
    }
  }

  // Reserve the format/version areas so data skips them.
  function reserveFormat(m) {
    const size = m.length;
    for (let i = 0; i < 9; i++) {
      if (m[8][i] === null) m[8][i] = false;
      if (m[i][8] === null) m[i][8] = false;
    }
    for (let i = 0; i < 8; i++) {
      if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = false;
      if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = false;
    }
    m[size - 8][8] = true; // dark module (always set)
  }

  function reserveVersionInfo(m, version) {
    if (version < 7) return;
    const size = m.length;
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3);
      const c = i % 3;
      m[r][size - 11 + c] = false;
      m[size - 11 + c][r] = false;
    }
  }

  // A matrix marking which cells are function patterns (immutable).
  function functionMask(version, size) {
    const fm = makeMatrix(size);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) fm[r][c] = false;
    const mark = (r, c) => { if (r >= 0 && c >= 0 && r < size && c < size) fm[r][c] = true; };

    // Finders + separators.
    for (const [br, bc] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) mark(br + r, bc + c);
    }
    // Timing.
    for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
    // Alignment.
    const positions = ALIGN_POS[version];
    for (const r of positions) {
      for (const c of positions) {
        if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(r + dr, c + dc);
      }
    }
    // Format areas.
    for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
    for (let i = 0; i < 8; i++) { mark(8, size - 1 - i); mark(size - 1 - i, 8); }
    // Version info.
    if (version >= 7) {
      for (let i = 0; i < 18; i++) {
        const r = Math.floor(i / 3);
        const c = i % 3;
        mark(r, size - 11 + c);
        mark(size - 11 + c, r);
      }
    }
    return fm;
  }

  function placeData(m, fm, codewords) {
    const size = m.length;
    const bits = [];
    for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >>> i) & 1);

    let bitIndex = 0;
    let upward = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--; // skip the vertical timing column
      for (let i = 0; i < size; i++) {
        const row = upward ? size - 1 - i : i;
        for (let c = 0; c < 2; c++) {
          const cc = col - c;
          if (fm[row][cc]) continue;
          const bit = bitIndex < bits.length ? bits[bitIndex++] : 0;
          m[row][cc] = bit === 1;
        }
      }
      upward = !upward;
    }
  }

  // ── Masking ─────────────────────────────────────────────────────────
  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  function applyMask(m, fm, maskIndex) {
    const size = m.length;
    const out = makeMatrix(size);
    const mask = MASKS[maskIndex];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        out[r][c] = m[r][c];
        if (!fm[r][c] && mask(r, c)) out[r][c] = !out[r][c];
      }
    }
    return out;
  }

  function penalty(m) {
    const size = m.length;
    let score = 0;
    // Rule 1: runs of 5+ same-colour modules in a row/column.
    for (let r = 0; r < size; r++) {
      let runC = 1, runR = 1;
      for (let c = 1; c < size; c++) {
        if (m[r][c] === m[r][c - 1]) { runC++; } else { if (runC >= 5) score += runC - 2; runC = 1; }
        if (m[c][r] === m[c - 1][r]) { runR++; } else { if (runR >= 5) score += runR - 2; runR = 1; }
      }
      if (runC >= 5) score += runC - 2;
      if (runR >= 5) score += runR - 2;
    }
    // Rule 2: 2x2 blocks of the same colour.
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }
    // Rule 3: finder-like 1:1:3:1:1 patterns.
    const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
    const pat2 = [false, false, false, false, true, false, true, true, true, false, true];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (c + 11 <= size) {
          let ok1 = true, ok2 = true;
          for (let k = 0; k < 11; k++) {
            if (m[r][c + k] !== pat1[k]) ok1 = false;
            if (m[r][c + k] !== pat2[k]) ok2 = false;
          }
          if (ok1) score += 40;
          if (ok2) score += 40;
        }
        if (r + 11 <= size) {
          let ok1 = true, ok2 = true;
          for (let k = 0; k < 11; k++) {
            if (m[r + k][c] !== pat1[k]) ok1 = false;
            if (m[r + k][c] !== pat2[k]) ok2 = false;
          }
          if (ok1) score += 40;
          if (ok2) score += 40;
        }
      }
    }
    // Rule 4: proportion of dark modules — penalise drift from 50%.
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
    const k = Math.abs(Math.ceil((dark * 100) / (size * size) / 5) - 10);
    score += k * 10;
    return score;
  }

  // ── Format & version information bits ────────────────────────────────
  function formatBits(eccIndex, maskIndex) {
    // 5 data bits: 2 ecc level (per spec encoding) + 3 mask.
    const eccBitsMap = [1, 0, 3, 2]; // L,M,Q,H -> spec 2-bit value
    const data = (eccBitsMap[eccIndex] << 3) | maskIndex;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    const bits = (((data << 10) | rem) ^ 0x5412) & 0x7fff;
    // The 15 BCH bits are laid out most-significant-first, so reverse
    // them: bit i of the returned value is placed at format position i.
    let rev = 0;
    for (let i = 0; i < 15; i++) rev |= ((bits >> i) & 1) << (14 - i);
    return rev;
  }

  function placeFormat(m, eccIndex, maskIndex) {
    const size = m.length;
    const bits = formatBits(eccIndex, maskIndex);
    const get = (i) => ((bits >>> i) & 1) === 1;
    // Around top-left finder.
    for (let i = 0; i <= 5; i++) m[8][i] = get(i);
    m[8][7] = get(6);
    m[8][8] = get(7);
    m[7][8] = get(8);
    for (let i = 9; i < 15; i++) m[14 - i][8] = get(i);
    // Around the other two finders. Vertical strip down col 8 carries
    // bits 0–6 (the cell at row size-8 is the always-dark module, set
    // last); the horizontal strip along row 8 carries bits 7–14 across
    // cols size-8 … size-1.
    for (let i = 0; i <= 7; i++) m[size - 1 - i][8] = get(i);
    for (let i = 7; i < 15; i++) m[8][size - 8 + (i - 7)] = get(i);
    m[size - 8][8] = true; // dark module
  }

  const VERSION_INFO = {
    7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3,
  };
  function placeVersion(m, version) {
    if (version < 7) return;
    const size = m.length;
    const bits = VERSION_INFO[version];
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const r = Math.floor(i / 3);
      const c = i % 3;
      m[r][size - 11 + c] = bit;
      m[size - 11 + c][r] = bit;
    }
  }

  // ── Public encode ───────────────────────────────────────────────────
  // `forceMask` (0–7) is an internal/testing hook that pins the data
  // mask instead of choosing the lowest-penalty one; callers leave it
  // undefined so the best mask is selected automatically.
  function encode(text, eccName, forceMask) {
    const eccIndex = ECC_LEVELS[(eccName || "M").toUpperCase()];
    if (eccIndex === undefined) throw new Error("qr: unknown ECC level " + eccName);

    const bytes = utf8Bytes(String(text));
    const version = chooseVersion(bytes.length, eccIndex);
    const size = version * 4 + 17;

    const dataCodewords = buildDataCodewords(bytes, version, eccIndex);
    const finalCodewords = buildFinalCodewords(dataCodewords, version, eccIndex);

    const m = makeMatrix(size);
    placeFinder(m, 0, 0);
    placeFinder(m, 0, size - 7);
    placeFinder(m, size - 7, 0);
    placeAlignment(m, version);
    placeTiming(m);
    reserveFormat(m);
    reserveVersionInfo(m, version);

    const fm = functionMask(version, size);
    placeData(m, fm, finalCodewords);

    // Choose the best mask.
    let best = null;
    let bestScore = Infinity;
    let bestMask = 0;
    for (let mask = 0; mask < 8; mask++) {
      if (forceMask != null && mask !== forceMask) continue;
      const candidate = applyMask(m, fm, mask);
      placeFormat(candidate, eccIndex, mask);
      placeVersion(candidate, version);
      const score = penalty(candidate);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
        bestMask = mask;
      }
    }
    void bestMask;

    // Normalise nulls (any untouched cell) to false.
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) if (best[r][c] === null) best[r][c] = false;
    }
    return { size, modules: best, mask: bestMask, version };
  }

  // ── SVG rendering ───────────────────────────────────────────────────
  function toSvg(text, opts) {
    const o = opts || {};
    const margin = o.margin == null ? 4 : o.margin;
    const scale = o.scale == null ? 4 : o.scale;
    const dark = o.dark || "#2d2a26";
    const light = o.light || "#fffdf7";
    const { size, modules } = encode(text, o.ecc || "M");

    const dim = (size + margin * 2) * scale;
    let path = "";
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!modules[r][c]) continue;
        const x = (c + margin) * scale;
        const y = (r + margin) * scale;
        path += `M${x} ${y}h${scale}v${scale}h-${scale}z`;
      }
    }
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" ` +
      `width="${dim}" height="${dim}" shape-rendering="crispEdges" role="img">` +
      `<rect width="${dim}" height="${dim}" fill="${light}"/>` +
      `<path d="${path}" fill="${dark}"/>` +
      `</svg>`
    );
  }

  const api = { encode, toSvg };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.tinkerQR = api;
})(typeof window !== "undefined" ? window : globalThis);
