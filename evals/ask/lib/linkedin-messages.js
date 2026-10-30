/* Pair LinkedIn messages.csv rows → anonymized question + Tyler reply.
 *
 * Official LinkedIn export columns:
 *   CONVERSATION ID, CONVERSATION TITLE, FROM, SENDER PROFILE URL,
 *   TO, RECIPIENT PROFILE URLS, DATE, SUBJECT, CONTENT, FOLDER
 *
 * Never logs raw CONTENT of real exports. Callers must not commit export data.
 */

"use strict";

const crypto = require("node:crypto");

const DEFAULT_SELF_NAMES = ["Tyler Lindow", "Tyler"];
const DEFAULT_SELF_URL_HINTS = ["tlindow", "/in/tlindow"];

/** Minimal RFC4180-ish CSV parse (quoted fields, commas, newlines). */
function parseCsv(text) {
  const src = String(text == null ? "" : text).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((c) => String(c).trim() !== "")) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((c) => String(c).trim() !== "")) rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((cols) => {
    const obj = {};
    for (let h = 0; h < headers.length; h++) {
      obj[headers[h]] = cols[h] == null ? "" : String(cols[h]);
    }
    return obj;
  });
}

function normalizeName(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isSelfMessage(row, { selfNames, selfUrlHints } = {}) {
  const names = (selfNames && selfNames.length ? selfNames : DEFAULT_SELF_NAMES).map(normalizeName);
  const from = normalizeName(row.FROM || row.from);
  if (names.some((n) => from === n || from.startsWith(n + " "))) return true;

  const url = String(row["SENDER PROFILE URL"] || row.senderProfileUrl || "").toLowerCase();
  const hints = selfUrlHints && selfUrlHints.length ? selfUrlHints : DEFAULT_SELF_URL_HINTS;
  if (url && hints.some((h) => url.includes(String(h).toLowerCase()))) return true;
  return false;
}

function parseLinkedInDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return 0;
  const t = Date.parse(s);
  if (Number.isFinite(t)) return t;
  // Fallback: LinkedIn sometimes uses "YYYY-MM-DD HH:mm:ss UTC"
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(s);
  if (m) {
    const t2 = Date.parse(`${m[1]}T${m[2]}Z`);
    return Number.isFinite(t2) ? t2 : 0;
  }
  return 0;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Pull likely person / company tokens from conversation title + FROM. */
function collectIdentifyingTokens(row) {
  const tokens = new Set();
  const from = String(row.FROM || "").trim();
  if (from) {
    tokens.add(from);
    from.split(/\s+/).forEach((p) => {
      if (p.length >= 2) tokens.add(p);
    });
  }
  const title = String(row["CONVERSATION TITLE"] || "").trim();
  if (title) {
    // Titles are often "Ada Example" or "Ada Example, Bob Other"
    title.split(/[,|–—-]/).forEach((part) => {
      const p = part.trim();
      if (!p) return;
      tokens.add(p);
      // "Name at Company" / "Name | Company"
      const at = /^(.*?)\s+(?:at|@|\|)\s+(.+)$/i.exec(p);
      if (at) {
        tokens.add(at[1].trim());
        tokens.add(at[2].trim());
      }
    });
  }
  const subject = String(row.SUBJECT || "").trim();
  if (subject && subject.length < 80) tokens.add(subject);
  return [...tokens].filter(Boolean).sort((a, b) => b.length - a.length);
}

/**
 * Rewrite an incoming LinkedIn message into a generic question.
 * Strips the other person's name, their company, URLs, emails, phones.
 * Does not invent a new ask — preserves intent with placeholders.
 */
function anonymizeIncoming(content, row, { selfNames } = {}) {
  let text = String(content == null ? "" : content);
  const tokens = collectIdentifyingTokens(row);

  // Strip URLs, emails, phones first.
  text = text.replace(/https?:\/\/\S+/gi, "[link]");
  text = text.replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/gi, "[email]");
  text = text.replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[phone]");
  text = text.replace(/linkedin\.com\/in\/\S+/gi, "[profile]");

  const selfList = selfNames && selfNames.length ? selfNames : DEFAULT_SELF_NAMES;
  const selfSet = new Set(selfList.map(normalizeName));

  // Replace the recipient's own name with "you" first (longest first).
  [...selfList]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .forEach((name) => {
      const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi");
      text = text.replace(re, "you");
    });

  for (const token of tokens) {
    if (!token || token.length < 2) continue;
    if (selfSet.has(normalizeName(token))) continue;
    const re = new RegExp(`\\b${escapeRegExp(token)}\\b`, "gi");
    text = text.replace(re, "[name]");
  }

  // Company-ish patterns after name scrub: "at Acme", "from Globex".
  // Do not let the company token run past a sentence boundary.
  text = text.replace(
    /\b(at|from|with|joining(?:\s+the\s+team\s+at)?)\s+([A-Z][A-Za-z0-9&+']*(?:\s+[A-Z][A-Za-z0-9&+']*){0,3})/g,
    "$1 [company]",
  );

  // Collapse leftover [name] runs and whitespace.
  text = text.replace(/\[name\](?:\s*\[name\])+/g, "[name]");
  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  text = text.replace(/[ \t]{2,}/g, " ");

  if (!text) return "";

  // Frame as a generic inbound ask when it isn't already a question.
  if (!/[?？]\s*$/.test(text) && !/^(what|how|why|when|where|who|would|could|can|do|are|is)\b/i.test(text)) {
    return `Someone reached out: ${text}`;
  }
  return text;
}

function stableId(conversationId, date, content) {
  const h = crypto
    .createHash("sha1")
    .update(`${conversationId}|${date}|${content}`)
    .digest("hex")
    .slice(0, 12);
  return `linkedin-${h}`;
}

/**
 * Build dataset rows from parsed CSV objects.
 * Each row: incoming message → Tyler's next reply in the same conversation.
 */
function pairMessages(rows, opts = {}) {
  const selfNames = opts.selfNames || DEFAULT_SELF_NAMES;
  const selfUrlHints = opts.selfUrlHints || DEFAULT_SELF_URL_HINTS;
  const minReplyChars = opts.minReplyChars == null ? 8 : opts.minReplyChars;

  const byConvo = new Map();
  for (const raw of rows) {
    const convoId = String(raw["CONVERSATION ID"] || raw.conversationId || "").trim();
    if (!convoId) continue;
    const content = String(raw.CONTENT || raw.content || "").trim();
    if (!content) continue;
    const folder = String(raw.FOLDER || raw.folder || "").trim().toLowerCase();
    // Skip MESSAGE_REQUEST_PENDING noise when possible; keep INBOX/ARCHIVE.
    if (folder && folder.includes("spam")) continue;

    const entry = {
      conversationId: convoId,
      conversationTitle: String(raw["CONVERSATION TITLE"] || ""),
      from: String(raw.FROM || ""),
      senderProfileUrl: String(raw["SENDER PROFILE URL"] || ""),
      to: String(raw.TO || ""),
      dateRaw: String(raw.DATE || ""),
      dateMs: parseLinkedInDate(raw.DATE),
      subject: String(raw.SUBJECT || ""),
      content,
      folder: String(raw.FOLDER || ""),
      isSelf: isSelfMessage(raw, { selfNames, selfUrlHints }),
      _raw: raw,
    };
    if (!byConvo.has(convoId)) byConvo.set(convoId, []);
    byConvo.get(convoId).push(entry);
  }

  const pairs = [];
  for (const [, msgs] of byConvo) {
    msgs.sort((a, b) => a.dateMs - b.dateMs || a.content.localeCompare(b.content));
    for (let i = 0; i < msgs.length; i++) {
      const incoming = msgs[i];
      if (incoming.isSelf) continue;
      let reply = null;
      for (let j = i + 1; j < msgs.length; j++) {
        if (msgs[j].isSelf) {
          reply = msgs[j];
          break;
        }
      }
      if (!reply) continue;
      if (String(reply.content).trim().length < minReplyChars) continue;

      const question = anonymizeIncoming(incoming.content, incoming._raw, { selfNames });
      if (!question || question.length < 3) continue;

      // Refuse to ship if anonymization left a clear full name that matches FROM.
      const fromNorm = normalizeName(incoming.from);
      if (fromNorm && fromNorm.length > 3 && normalizeName(question).includes(fromNorm)) {
        continue;
      }

      pairs.push({
        id: stableId(incoming.conversationId, incoming.dateRaw, incoming.content),
        question,
        source: "linkedin",
        tyler_answer: reply.content.trim(),
        category: "agreement",
        input: "typed",
        essayId: null,
        essayTitle: null,
        promptIndex: null,
        expect: {
          minSentences: 1,
          maxSentences: 12,
        },
        notes:
          "Paired from LinkedIn export (incoming → Tyler's next reply). Question anonymized; reply is Tyler's reference.",
        metadata: {
          conversationIdHash: crypto
            .createHash("sha1")
            .update(incoming.conversationId)
            .digest("hex")
            .slice(0, 12),
          // Never store raw names/URLs from the other person in metadata.
          folder: incoming.folder || "",
          pairedAt: new Date().toISOString(),
        },
      });
    }
  }
  return pairs;
}

function loadPairsFromCsvText(csvText, opts = {}) {
  const rows = parseCsv(csvText);
  return pairMessages(rows, opts);
}

module.exports = {
  DEFAULT_SELF_NAMES,
  DEFAULT_SELF_URL_HINTS,
  parseCsv,
  parseLinkedInDate,
  isSelfMessage,
  collectIdentifyingTokens,
  anonymizeIncoming,
  pairMessages,
  loadPairsFromCsvText,
  stableId,
};
