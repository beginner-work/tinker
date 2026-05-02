/* tinker search proxy — Vercel serverless function.
 *
 * The clients (Electron desktop, Capacitor mobile, plain web) POST a
 * { query } here. The Anthropic API key is read from the server-side
 * env var ANTHROPIC_API_KEY and never leaves Vercel.
 *
 * Set the key in the Vercel project: Settings → Environment Variables.
 */

const Anthropic = require("@anthropic-ai/sdk").default;

const SEARCH_SYSTEM_PROMPT = `You are the search engine for the tinker web browser — a quiet alternative to ad-driven search.

When you receive a query, write a calm, conversational answer in three to five short paragraphs that helps the reader understand the topic and where to go next. Embed Markdown links to specific, well-known websites — Wikipedia, official organisation sites, established publications, .gov pages — where the reader can read more or take action. Format links exactly as [label](https://example.com).

Voice: warm, plainspoken, calm. Address the reader as "you" where natural. No headings, no bulleted lists — just flowing prose, with short paragraphs separated by blank lines.

Only include links to sources you'd actually recommend and that you are confident exist. Do not invent URLs. If you are uncertain about a specific URL, omit the link rather than guess. It is better to write a confident paragraph with no link than to fabricate one.`;

let client = null;
function getClient() {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error("ANTHROPIC_API_KEY is not configured on the server");
    err.status = 500;
    throw err;
  }
  client = new Anthropic({ apiKey });
  return client;
}

module.exports = async function handler(req, res) {
  // Capacitor (capacitor://) and plain web both hit this from a non-Vercel
  // origin, so allow CORS. Tighten the origin once the app's domains settle.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body || {};
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return res.status(400).json({ error: "Query is required" });
  }

  try {
    const message = await getClient().messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SEARCH_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: query }],
    });
    const textBlock = (message.content || []).find((b) => b.type === "text");
    return res.status(200).json({
      text: textBlock ? textBlock.text : "",
      usage: message.usage,
    });
  } catch (err) {
    const status = err.status && Number.isInteger(err.status) ? err.status : 500;
    return res.status(status).json({
      error: err.message || "Search failed",
    });
  }
};

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
