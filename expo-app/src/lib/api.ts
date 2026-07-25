/**
 * api — thin client for tinker's Vercel functions (api/search.js, and the
 * Claude interview loop). Both endpoints authenticate a Stytch session with
 * a Bearer token, so the app needs a base URL + token to reach the real
 * backend.
 *
 * Configure via app.json -> expo.extra:
 *   { "tinkerApiBase": "https://tinker.example.com", "tinkerToken": "..." }
 * or set them at runtime. When neither is present (the common case in the
 * v0 web preview, which can't hold a live Stytch session), the client falls
 * back to a calm, self-contained local essay so the flow stays demonstrable
 * end-to-end instead of dead-ending on a 401.
 */

import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as {
  tinkerApiBase?: string;
  tinkerToken?: string;
};

export const API_BASE = extra.tinkerApiBase ?? "";
export const API_TOKEN = extra.tinkerToken ?? "";

export const hasBackend = Boolean(API_BASE && API_TOKEN);

export type SearchResult = { text: string; source: "api" | "fallback" };

export async function search(query: string): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { text: "", source: "fallback" };

  if (hasBackend) {
    try {
      const res = await fetch(`${API_BASE}/api/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_TOKEN}`,
        },
        body: JSON.stringify({ query: q }),
      });
      if (res.ok) {
        const data = (await res.json()) as { text?: string };
        if (data.text) return { text: data.text, source: "api" };
      }
    } catch {
      /* fall through to the calm fallback */
    }
  }

  return { text: fallbackEssay(q), source: "fallback" };
}

/**
 * A gentle, offline stand-in shaped like the real Claude Haiku reply: three
 * short paragraphs of plain prose with a couple of Markdown links. Not an
 * answer to the literal query — a note explaining the quiet-search idea, so
 * the essay screen renders realistically without a live key.
 */
function fallbackEssay(query: string): string {
  return [
    `You asked about **${query}**. In the full tinker, this space fills with a short, calm essay written by Claude — three to five plain paragraphs that help you understand the topic and point you somewhere real to read more.`,
    "",
    `There are no ads here and no ten blue links racing for your attention — just prose, with the occasional link woven in where it earns its place, like [Wikipedia](https://wikipedia.org) or an official source. It is meant to feel like asking a well-read friend, not querying a machine.`,
    "",
    `To see live answers, point the app at your deployment: set \`tinkerApiBase\` and \`tinkerToken\` in app.json's \`extra\`. Until then, this quiet placeholder stands in so you can feel the shape of the thing.`,
  ].join("\n");
}
