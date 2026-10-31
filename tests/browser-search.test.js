/* Unit tests for learn/browser-search: pick parsing + prefer authored sources. */

"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const browserSearch = require("../api/_lib/browser-search.js");

describe("browser-search preferAuthoredSource", () => {
  test("swaps to an authored alternate when chosen has none", async () => {
    const pages = {
      "https://a.example/no-author": {
        sourceUrl: "https://a.example/no-author",
        title: "No Author",
        author: "",
        authorSource: "none",
        authorUnknown: true,
        siteName: "",
        text: "x".repeat(80),
        wordCount: 10,
        attribution: "No Author Author unknown",
      },
      "https://b.example/has-author": {
        sourceUrl: "https://b.example/has-author",
        title: "Has Author",
        author: "Riley Chen",
        authorSource: "jsonld",
        authorUnknown: false,
        siteName: "B Blog",
        text: "y".repeat(80),
        wordCount: 10,
        attribution: "Has Author By Riley Chen (B Blog)",
      },
    };
    const hit = await browserSearch.preferAuthoredSource(
      ["https://a.example/no-author", "https://b.example/has-author"],
      { fetchPageFn: async (url) => pages[url] },
    );
    assert.equal(hit.url, "https://b.example/has-author");
    assert.equal(hit.author, "Riley Chen");
    assert.equal(hit.authorUnknown, false);
  });

  test("keeps first successful fetch when none have authors", async () => {
    const hit = await browserSearch.preferAuthoredSource(
      ["https://a.example/x", "https://b.example/y"],
      {
        fetchPageFn: async (url) => ({
          sourceUrl: url,
          title: "T",
          author: "",
          authorUnknown: true,
          authorSource: "none",
          siteName: "",
          text: "z".repeat(80),
          wordCount: 5,
        }),
      },
    );
    assert.equal(hit.url, "https://a.example/x");
    assert.equal(hit.authorUnknown, true);
  });
});

describe("browser-search runWebSearch", () => {
  test("prefers authored result over model pick without inventing authors", async () => {
    const result = await browserSearch.runWebSearch("postgres MVCC", {
      preferAuthored: true,
      callAnthropicFn: async () => ({
        text: JSON.stringify({
          chosenUrl: "https://wiki.example/no-author",
          why: "Top hit.",
          alternatives: [
            { url: "https://docs.example/with-author", why: "Also good." },
          ],
        }),
        content: [
          {
            type: "web_search_tool_result",
            content: [
              {
                type: "web_search_result",
                url: "https://wiki.example/no-author",
                title: "MVCC wiki",
              },
              {
                type: "web_search_result",
                url: "https://docs.example/with-author",
                title: "MVCC guide",
              },
            ],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      fetchPageFn: async (url) => {
        if (url.includes("with-author")) {
          return {
            sourceUrl: url,
            title: "MVCC guide",
            author: "Avery Kim",
            authorSource: "meta_author",
            authorUnknown: false,
            siteName: "Docs",
            text: "t".repeat(100),
            wordCount: 20,
          };
        }
        return {
          sourceUrl: url,
          title: "MVCC wiki",
          author: "",
          authorSource: "none",
          authorUnknown: true,
          siteName: "",
          text: "t".repeat(100),
          wordCount: 20,
        };
      },
    });
    assert.equal(result.chosen.url, "https://docs.example/with-author");
    assert.equal(result.chosen.author, "Avery Kim");
    assert.equal(result.chosen.authorUnknown, false);
    assert.ok(result.alternatives.some((a) => a.url === "https://wiki.example/no-author"));
  });
});
