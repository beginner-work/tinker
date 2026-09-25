/* Pull text out of a text-based PDF. Scanned pages have no text layer
 * and come back as an error so the user can upload markdown instead.
 * No new paid service. Node's zlib inflates FlateDecode streams.
 */

"use strict";

const zlib = require("zlib");

function decodePdfString(body) {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = body[++i];
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "(" || next === ")" || next === "\\") out += next;
    else if (next >= "0" && next <= "7") {
      let oct = next;
      for (let k = 0; k < 2; k++) {
        const digit = body[i + 1];
        if (digit >= "0" && digit <= "7") {
          oct += digit;
          i++;
        } else break;
      }
      out += String.fromCharCode(parseInt(oct, 8));
    } else if (next === undefined) {
      break;
    } else {
      out += next;
    }
  }
  return out;
}

function stringsFrom(chunk) {
  const parts = [];
  const pattern = /\((?:\\.|[^\\)])*\)/g;
  let match;
  while ((match = pattern.exec(chunk))) {
    const raw = match[0].slice(1, -1);
    const text = decodePdfString(raw).replace(/\s+/g, " ").trim();
    if (text) parts.push(text);
  }
  return parts.join(" ");
}

function inflateStream(data) {
  try {
    return zlib.inflateSync(data);
  } catch {
    try {
      return zlib.unzipSync(data);
    } catch {
      return null;
    }
  }
}

function extractPdfText(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input || "");
  const raw = bytes.toString("latin1");
  if (!raw.includes("%PDF")) {
    throw Object.assign(new Error("That file is not a PDF."), { status: 400 });
  }
  const parts = [];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let match;
  while ((match = streamRe.exec(raw))) {
    let data = Buffer.from(match[1], "latin1");
    while (data.length && (data[data.length - 1] === 0x0a || data[data.length - 1] === 0x0d)) {
      data = data.subarray(0, data.length - 1);
    }
    const headerStart = Math.max(0, match.index - 300);
    const header = raw.slice(headerStart, match.index);
    let text = data.toString("latin1");
    if (/FlateDecode/.test(header)) {
      const inflated = inflateStream(data);
      if (!inflated) continue;
      text = inflated.toString("latin1");
    }
    const pulled = stringsFrom(text);
    if (pulled) parts.push(pulled);
  }
  const joined = parts.join("\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!joined) {
    throw Object.assign(new Error("Could not read text from that PDF. Upload markdown instead."), {
      status: 400,
    });
  }
  return joined;
}

module.exports = { extractPdfText, decodePdfString };
