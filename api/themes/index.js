/* POST /api/themes
 *
 * Authorization: Bearer <stytch session_token>
 * Reply: { themes: [{ label, sourceId, sourceOffset, sourceLength, clusterIds: [...] }, ...] }
 *
 * Server-side clustering of the founder's seeds + drafts + essays into
 * three to seven themes. Each theme's `label` is a verbatim substring
 * of one of the founder's writings — the function reads the substring
 * at the reported offset/length and drops any theme whose label
 * doesn't match its source character range. AI-authored labels die at
 * the API layer, not the prompt; better to ship four valid themes than
 * five with one fabricated.
 *
 * Reads the per-user blobs straight out of TinkerUserData (kinds:
 * seeds, drafts, essays). The client is expected to flush its sync.js
 * queue before triggering this call so the server reads the freshest
 * available state.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const prisma = require("../_lib/db.js");

const SYSTEM_PROMPT = `You are tinker's theme-clustering step.

The user message contains a corpus of one founder's own writings — seeds, drafts, and essays. Each item is prefixed with [N] for reference. Your job is to identify three to seven themes that span their work.

ABSOLUTE RULES:
1. Each theme's label MUST be a contiguous, character-perfect substring of one of the writings in the corpus. You do not paraphrase, prettify, summarise, or compose. If you cannot find a label in the founder's own words, return fewer themes.
2. The label must read as a theme-level observation — a recurring through-line the founder is working with — not a tactical fragment about a single moment.
3. The label must be short: roughly three to ten words. Lowercase, fragment style.
4. An item may appear in at most one theme. It's fine to leave items unclustered.
5. NO judgmental phrasing. No characterisations of the founder. The label reflects; it does not commentate.

RESPONSE FORMAT (strict JSON, no fences, no prose outside it):

{
  "themes": [
    {
      "label": "<verbatim substring from sourceItem>",
      "sourceItem": <integer item number>,
      "offset": <0-based character index where the label starts in that item's text>,
      "length": <character length of the label>,
      "items": [<item numbers that belong to this theme>]
    },
    ...
  ]
}

If there is not enough writing to surface three valid themes, return { "themes": [] }.`;

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

async function resolveUserId(req) {
  const token = extractBearer(req.headers && req.headers.authorization);
  const session = await authenticateSession(token);
  const userId =
    (session && session.session && session.session.user_id) ||
    (session && session.user && session.user.user_id) ||
    "";
  if (!userId) {
    throw Object.assign(new Error("Session missing user id"), { status: 401 });
  }
  return userId;
}

// Pulls the three corpus blobs out of the kind-keyed user-data table
// and flattens them into a single ordered list. Each item carries an
// id (so the response can name cluster members back to the client),
// a seedName (the location it was written at — what the founder picks
// from the welcome grid, e.g. "Cafe" or "the kitchen counter"), and
// the raw text the clusterer reads.
async function loadCorpus(userId) {
  const rows = await prisma.tinkerUserData.findMany({
    where: { userId, kind: { in: ["seeds", "drafts", "essays"] } },
  });

  const byKind = {};
  for (const row of rows) byKind[row.kind] = row.data;

  const items = [];

  const seedsBlob = byKind.seeds || {};
  const explicit = Array.isArray(seedsBlob.explicit) ? seedsBlob.explicit : [];
  for (const s of explicit) {
    if (!s || !s.name) continue;
    items.push({
      id: s.id || `seed:${s.name}`,
      type: "seed",
      text: String(s.name),
      seedName: String(s.name),
    });
  }

  const drafts = Array.isArray(byKind.drafts) ? byKind.drafts : [];
  for (const d of drafts) {
    if (!d || !d.id) continue;
    const parts = [];
    if (Array.isArray(d.transcript)) {
      for (const t of d.transcript) {
        if (t && t.a) parts.push(String(t.a));
      }
    }
    if (d.stitched && d.stitched.body) parts.push(String(d.stitched.body));
    const text = parts.join("\n").trim();
    if (text) {
      items.push({
        id: d.id,
        type: "draft",
        text,
        seedName: d.seed ? String(d.seed) : null,
      });
    }
  }

  const essays = Array.isArray(byKind.essays) ? byKind.essays : [];
  for (const e of essays) {
    if (!e || !e.id) continue;
    const text = String(e.body || "").trim();
    if (text) {
      items.push({
        id: e.id,
        type: "essay",
        text,
        seedName: e.seed ? String(e.seed) : null,
      });
    }
  }

  return items;
}

function buildPrompt(items) {
  return items.map((it, i) => `[${i + 1}] (${it.type})\n${it.text}`).join("\n\n---\n\n");
}

async function callAnthropic(corpusText) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw Object.assign(new Error("ANTHROPIC_API_KEY is not set."), { status: 503 });
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: corpusText }],
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (data && (data.error?.message || data.error)) || `Anthropic ${res.status}`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  const textBlock = (data.content || []).find((b) => b.type === "text");
  return textBlock ? textBlock.text : "";
}

function tryParseJson(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

// The verbatim guarantee: drop any theme whose label doesn't read back
// character-for-character from the named source's text at the reported
// offset/length. This is the API-layer check the spec calls for — the
// prompt asks for it, this function enforces it.
function validateThemes(parsed, items) {
  if (!parsed || !Array.isArray(parsed.themes)) return [];
  const valid = [];
  const seenItems = new Set();
  for (const t of parsed.themes) {
    if (!t || typeof t.label !== "string") continue;
    const idx = Number(t.sourceItem);
    if (!Number.isInteger(idx) || idx < 1 || idx > items.length) continue;
    const source = items[idx - 1];
    const offset = Number(t.offset);
    const length = Number(t.length);
    if (!Number.isInteger(offset) || !Number.isInteger(length)) continue;
    if (offset < 0 || length <= 0 || offset + length > source.text.length) continue;
    const slice = source.text.substring(offset, offset + length);
    if (slice !== t.label) continue;

    const clusterIds = [];
    const locationSet = new Set();
    const locationOrder = [];
    if (Array.isArray(t.items)) {
      for (const ix of t.items) {
        const n = Number(ix);
        if (!Number.isInteger(n) || n < 1 || n > items.length) continue;
        if (seenItems.has(n)) continue;
        seenItems.add(n);
        const it = items[n - 1];
        clusterIds.push(it.id);
        // Deduplicate locations while preserving the order they were
        // first seen in the cluster — gives a stable chip ordering
        // across refreshes for the same underlying writing.
        if (it.seedName && !locationSet.has(it.seedName)) {
          locationSet.add(it.seedName);
          locationOrder.push(it.seedName);
        }
      }
    }
    valid.push({
      label: t.label,
      sourceId: source.id,
      sourceOffset: offset,
      sourceLength: length,
      clusterIds,
      locations: locationOrder,
    });
  }
  return valid.slice(0, 7);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let userId;
  try {
    userId = await resolveUserId(req);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  let items;
  try {
    items = await loadCorpus(userId);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to load corpus" });
    return;
  }

  if (items.length === 0) {
    res.status(200).json({ themes: [] });
    return;
  }

  const corpus = buildPrompt(items);

  // One retry if validation drops every theme — sometimes the model
  // returns near-miss substrings (smart quotes, trimmed whitespace).
  // We'd rather re-prompt once than ship an empty sidebar.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw;
    try {
      raw = await callAnthropic(corpus);
    } catch (err) {
      res.status(err.status || 502).json({ error: err.message || "Upstream error" });
      return;
    }
    const themes = validateThemes(tryParseJson(raw), items);
    if (themes.length > 0 || attempt === 1) {
      res.status(200).json({ themes });
      return;
    }
  }
};
