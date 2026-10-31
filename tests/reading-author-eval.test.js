/* Loads evals/reading-author/dataset cases and asserts resolveAuthorAttribution. */

"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fetchPage = require("../api/_lib/fetch-page.js");

const DATASET_DIR = path.join(
  __dirname,
  "..",
  "evals",
  "reading-author",
  "dataset",
);

describe("reading-author eval dataset", () => {
  const files = fs
    .readdirSync(DATASET_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  assert.ok(files.length >= 7, "expected author eval cases on disk");

  for (const file of files) {
    const caseRow = JSON.parse(
      fs.readFileSync(path.join(DATASET_DIR, file), "utf8"),
    );
    test(caseRow.id || file, () => {
      const html = caseRow.html || "";
      assert.ok(html, `${caseRow.id}: html required`);
      const attr = fetchPage.resolveAuthorAttribution(html);
      const expect = caseRow.expect || {};
      assert.equal(attr.author, expect.author, "author");
      assert.equal(attr.authorSource, expect.authorSource, "authorSource");
      assert.equal(
        Boolean(attr.authorUnknown),
        Boolean(expect.authorUnknown),
        "authorUnknown",
      );
      if (expect.siteName != null) {
        assert.equal(attr.siteName, expect.siteName, "siteName");
      }
      // Never invent: if unknown, author must be empty (display layer says Author unknown).
      if (expect.authorUnknown) {
        assert.equal(attr.author, "");
        assert.match(
          fetchPage.formatByline({ author: attr.author, authorUnknown: true }),
          /Author unknown/,
        );
      } else {
        assert.match(
          fetchPage.formatByline({ author: attr.author }),
          new RegExp(`By ${expect.author.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
        );
      }
    });
  }
});
