#!/usr/bin/env node
/**
 * Renders a pixel-art calico cat hugging the tinker rainbow globe.
 *
 * Writes two SVGs:
 *   - src/renderer/icons/cat-globe-icon.svg  (cream rounded-square)
 *   - src/renderer/icons/cat-globe-mark.svg  (transparent, mark only)
 *
 * Run: node scripts/build-cat-globe-logo.js
 *
 * The cat is a 40x40 pixel grid drawn from ASCII tiles below; the globe
 * is a scaled copy of the canonical tinker mark (radius 60 instead of 76)
 * so the cat has room to peek over the top and wrap its paws around the
 * bottom-front.
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'src', 'renderer', 'icons');

const PIXEL = 5;          // viewBox units per pixel
const GRID_W = 40;        // pixel-grid width
const GRID_H = 40;        // pixel-grid height
const VIEWBOX = 200;      // viewBox is 200x200

const COLORS = {
  K: '#1f1d1c', // cat black mask
  W: '#fdfbf6', // cat white fur
  O: '#e8924a', // calico orange
  N: '#d9776d', // pink nose
  P: '#f5b3b3', // pink paw pads
  G: '#7da670', // green eye iris
  H: '#ffffff', // eye highlight
};

// Head — 14 cols x 14 rows. Compact rounded skull with small folded
// Scottish-fold ear tabs on the corners (not pointy ears). Black mask
// wraps the upper face; white blaze runs from forehead to nose; green
// eyes flank the blaze with a tiny highlight pixel for sparkle; orange
// cheek patches sit around the pink nose; white muzzle and chin taper.
const HEAD = [
  '..KK......KK..',
  '.KKKK....KKKK.',
  '.KKKKKKKKKKKK.',
  'KKKKKKKKKKKKKK',
  'KKKKKKKKKKKKKK',
  'KKKKKKWWKKKKKK',
  'KKKGHKWWKHGKKK',
  'KKKGGKWWKGGKKK',
  'KKKKKWWWWKKKKK',
  'KKKKWWWWWWKKKK',
  'KKOOWNNNNWOOKK',
  '.KOOWNNNNWOOK.',
  '..OOWWWWWWOO..',
  '...WWWWWWWW...',
];

// Left arm — 14 cols x 16 rows. Overlaps the head's chin at the top so
// the shoulder reads as continuous with the body, bows OUT past the
// globe's left side at mid-height, then curves back IN and DOWN to a
// paw that meets its mirror at the front-center of the lower globe.
// Kept thin (2 cells wide along most of the curve) so the globe still
// shows through.
const LEFT_ARM = [
  '.......WW.....',
  '.......WW.....',
  '......WW......',
  '.....WW.......',
  '.....WW.......',
  '....WW........',
  '....WW........',
  '....WW........',
  '....WW........',
  '.....WW.......',
  '.....WWW......',
  '......WWW.....',
  '.......WWW....',
  '........WWW...',
  '.........WWW..',
  '..........WW..',
];

const mirrorRow = (row) => row.split('').reverse().join('');
const RIGHT_ARM = LEFT_ARM.map(mirrorRow);

function makeGrid() {
  return Array.from({ length: GRID_H }, () => Array(GRID_W).fill('.'));
}

function paint(grid, originRow, originCol, art) {
  for (let r = 0; r < art.length; r++) {
    for (let c = 0; c < art[r].length; c++) {
      const ch = art[r][c];
      if (ch === '.') continue;
      const gr = originRow + r;
      const gc = originCol + c;
      if (gr < 0 || gr >= GRID_H || gc < 0 || gc >= GRID_W) continue;
      if (!COLORS[ch]) throw new Error(`Unknown pixel char "${ch}" at row ${r}, col ${c}`);
      grid[gr][gc] = ch;
    }
  }
}

// Emit one <rect> per horizontal run of same-color pixels — keeps the SVG
// small without losing any pixel fidelity.
function rectsFromGrid(grid) {
  const out = [];
  for (let r = 0; r < GRID_H; r++) {
    let c = 0;
    while (c < GRID_W) {
      const ch = grid[r][c];
      if (ch === '.') { c++; continue; }
      let end = c;
      while (end < GRID_W && grid[r][end] === ch) end++;
      out.push(
        `<rect x="${c * PIXEL}" y="${r * PIXEL}" width="${(end - c) * PIXEL}" height="${PIXEL}" fill="${COLORS[ch]}"/>`
      );
      c = end;
    }
  }
  return out.join('\n  ');
}

// Scaled tinker globe — same palette and structure as
// src/renderer/tokens/rainbow-web.json, just slightly smaller (r=66 vs 76)
// and nudged downward (cy=110) so the cat head can peek above.
function globeSvg() {
  const cx = 100, cy = 110, r = 66, sw = 8;
  const latOffset = 33;
  const longRxOuter = 45;
  const longRxInner = 23;
  const latHalfTrop = Math.sqrt(r * r - latOffset * latOffset).toFixed(2);
  return [
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#C8B6E2" stroke-width="${sw}"/>`,
    `<line x1="${cx - latHalfTrop}" y1="${cy - latOffset}" x2="${cx + Number(latHalfTrop)}" y2="${cy - latOffset}" stroke="#F9A8D4" stroke-width="${sw}" stroke-linecap="round"/>`,
    `<line x1="${cx - r}" y1="${cy}" x2="${cx + r}" y2="${cy}" stroke="#FDBA74" stroke-width="${sw}" stroke-linecap="round"/>`,
    `<line x1="${cx - latHalfTrop}" y1="${cy + latOffset}" x2="${cx + Number(latHalfTrop)}" y2="${cy + latOffset}" stroke="#FDE68A" stroke-width="${sw}" stroke-linecap="round"/>`,
    `<ellipse cx="${cx}" cy="${cy}" rx="${longRxOuter}" ry="${r}" fill="none" stroke="#7BC47A" stroke-width="${sw}"/>`,
    `<ellipse cx="${cx}" cy="${cy}" rx="${longRxInner}" ry="${r}" fill="none" stroke="#7DD3FC" stroke-width="${sw}"/>`,
    `<line x1="${cx}" y1="${cy - r}" x2="${cx}" y2="${cy + r}" stroke="#6EE7B7" stroke-width="${sw}" stroke-linecap="round"/>`,
  ].join('\n  ');
}

function buildSvg({ withBackground }) {
  const grid = makeGrid();
  paint(grid, 0, 13, HEAD);
  paint(grid, 13, 8, LEFT_ARM);
  paint(grid, 13, 18, RIGHT_ARM);

  const bg = withBackground
    ? `<rect width="${VIEWBOX}" height="${VIEWBOX}" rx="44" fill="#F5F3EF"/>\n  `
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" fill="none">
  ${bg}${globeSvg()}
  ${rectsFromGrid(grid)}
</svg>
`;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const iconPath = path.join(OUT_DIR, 'cat-globe-icon.svg');
const markPath = path.join(OUT_DIR, 'cat-globe-mark.svg');
fs.writeFileSync(iconPath, buildSvg({ withBackground: true }));
fs.writeFileSync(markPath, buildSvg({ withBackground: false }));
console.log('Wrote', iconPath);
console.log('Wrote', markPath);
