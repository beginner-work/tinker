/* LinkedIn messages.csv → anonymized question + Tyler reply pairs. */

"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const lib = require("../evals/ask/lib/linkedin-messages.js");

const FIXTURE = path.join(
  __dirname,
  "..",
  "evals",
  "ask",
  "fixtures",
  "linkedin-messages.synthetic.csv",
);

describe("linkedin CSV parse + pairing", () => {
  test("synthetic fixture pairs inbound → Tyler next reply only", () => {
    const csv = fs.readFileSync(FIXTURE, "utf8");
    const pairs = lib.loadPairsFromCsvText(csv, {
      selfNames: ["Tyler Lindow", "Tyler"],
    });
    assert.equal(pairs.length, 3, `expected 3 pairs, got ${pairs.length}`);
    for (const p of pairs) {
      assert.equal(p.source, "linkedin");
      assert.equal(p.category, "agreement");
      assert.ok(p.tyler_answer && p.tyler_answer.length > 8);
      assert.ok(p.question && p.question.length > 3);
      assert.match(p.id, /^linkedin-[a-f0-9]+$/);
      // No raw other-person names left in the anonymized question.
      assert.equal(/Ada Example/i.test(p.question), false);
      assert.equal(/Ben Recruiter/i.test(p.question), false);
      assert.equal(/Globex/i.test(p.question), false);
      assert.equal(/Northwind/i.test(p.question), false);
      assert.equal(/ada\.example@/i.test(p.question), false);
      assert.equal(/https?:\/\//i.test(p.question), false);
      assert.equal(/\bTyler Lindow\b/i.test(p.question), false);
      // Tyler's reply keeps his own wording (reference answer).
      assert.equal(/linkedin\.com\/in\//i.test(p.tyler_answer), false);
    }
    // First convo: EM chat + Tuesday follow-up both paired.
    const answers = pairs.map((p) => p.tyler_answer);
    assert.ok(answers.some((a) => /founder-style coaching/i.test(a)));
    assert.ok(answers.some((a) => /Tuesday after 2pm/i.test(a)));
    assert.ok(answers.some((a) => /learns? in production/i.test(a)));
  });

  test("inbound without a Tyler reply is skipped", () => {
    const csv = [
      "CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,SUBJECT,CONTENT,FOLDER",
      "c_x,Only Them,Other Person,https://x.test/in/other,Tyler Lindow,https://www.linkedin.com/in/tlindow,2024-01-01 00:00:00 UTC,,Just saying hi,INBOX",
    ].join("\n");
    const pairs = lib.loadPairsFromCsvText(csv);
    assert.equal(pairs.length, 0);
  });

  test("anonymizeIncoming strips name, company, email, url", () => {
    const row = {
      FROM: "Ada Example",
      "CONVERSATION TITLE": "Ada Example",
      SUBJECT: "",
      CONTENT: "unused",
    };
    const out = lib.anonymizeIncoming(
      "Hi Tyler, I'm Ada Example at Globex Robotics — email ada.example@globex-fake.test or https://globex-fake.test/x",
      row,
    );
    assert.equal(/Ada Example/i.test(out), false);
    assert.equal(/Globex Robotics/i.test(out), false);
    assert.equal(/ada\.example@/i.test(out), false);
    assert.equal(/https?:\/\//i.test(out), false);
    assert.match(out, /\[email\]|\[link\]|\[company\]|\[name\]|you/i);
  });

  test("isSelfMessage matches Tyler by name or profile URL", () => {
    assert.equal(
      lib.isSelfMessage({
        FROM: "Tyler Lindow",
        "SENDER PROFILE URL": "https://www.linkedin.com/in/tlindow",
      }),
      true,
    );
    assert.equal(
      lib.isSelfMessage({
        FROM: "Ada Example",
        "SENDER PROFILE URL": "https://www.linkedin.com/in/ada-example-fake",
      }),
      false,
    );
    assert.equal(
      lib.isSelfMessage({
        FROM: "Someone",
        "SENDER PROFILE URL": "https://www.linkedin.com/in/tlindow",
      }),
      true,
    );
  });
});

describe("load-linkedin-messages CLI", () => {
  test("dry-run on synthetic fixture prints counts (no upload)", () => {
    const script = path.join(__dirname, "..", "scripts", "load-linkedin-messages.js");
    const r = spawnSync(
      process.execPath,
      [script, "--csv", FIXTURE, "--dry-run", "--json"],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const json = JSON.parse(r.stdout);
    assert.equal(json.pairs, 3);
    assert.equal(json.dryRun, true);
    assert.equal(json.upload, false);
    assert.equal(json.source, "linkedin");
  });

  test("refuses messages.csv basename without --allow-real", () => {
    const script = path.join(__dirname, "..", "scripts", "load-linkedin-messages.js");
    const tmpDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "li-"));
    const fake = path.join(tmpDir, "messages.csv");
    fs.writeFileSync(fake, fs.readFileSync(FIXTURE));
    const r = spawnSync(
      process.execPath,
      [script, "--csv", fake, "--dry-run", "--json"],
      { encoding: "utf8" },
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr || "", /--allow-real|Refusing real LinkedIn/i);
  });

  test("refuses --out inside the git work tree", () => {
    const script = path.join(__dirname, "..", "scripts", "load-linkedin-messages.js");
    const r = spawnSync(
      process.execPath,
      [
        script,
        "--csv",
        FIXTURE,
        "--dry-run",
        "--out",
        path.join(__dirname, "..", "evals/ask/dataset/linkedin/leak.jsonl"),
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr || "", /outside the git work tree/i);
  });
});

describe("repo hygiene", () => {
  test("gitignore blocks LinkedIn export paths and allows synthetic fixture", () => {
    const gi = fs.readFileSync(path.join(__dirname, "..", ".gitignore"), "utf8");
    assert.match(gi, /LinkedInDataExport/i);
    assert.match(gi, /messages\.csv/);
    assert.match(gi, /linkedin-messages\.synthetic\.csv/);
    assert.ok(fs.existsSync(FIXTURE));
    // Ensure we did not accidentally add a real messages.csv
    const real = path.join(__dirname, "..", "messages.csv");
    assert.equal(fs.existsSync(real), false);
  });
});
