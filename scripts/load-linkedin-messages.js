#!/usr/bin/env node
/* Load LinkedIn official data-export messages.csv into anonymized pairs
 * and optionally upload to a PRIVATE Braintrust dataset.
 *
 * Pairing: each inbound message → Tyler Lindow's next reply in that thread.
 * Incoming side is rewritten into a generic question (names / other-person
 * companies / URLs / emails stripped). Tyler's reply is tyler_answer.
 * source = "linkedin".
 *
 * NEVER commit a real LinkedIn export. Test with the synthetic fixture only.
 * Do not point this at real data in CI.
 *
 * Usage:
 *   # Local dry-run on the synthetic fixture (safe; default path in tests):
 *   node scripts/load-linkedin-messages.js \
 *     --csv evals/ask/fixtures/linkedin-messages.synthetic.csv \
 *     --dry-run --json
 *
 *   # Upload anonymized pairs (requires BRAINTRUST_API_KEY; still no repo write):
 *   node scripts/load-linkedin-messages.js --csv /absolute/path/to/messages.csv --upload
 *
 * Env:
 *   BRAINTRUST_API_KEY   required for --upload
 *   BRAINTRUST_PROJECT    default "tinker-ask"
 *   BRAINTRUST_LINKEDIN_DATASET  default "linkedin-replies-private"
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  loadPairsFromCsvText,
  DEFAULT_SELF_NAMES,
} = require("../evals/ask/lib/linkedin-messages.js");

const FORBIDDEN_BASENAMES = new Set([
  // Real LinkedIn export filename — refuse unless --allow-real is passed
  // (still never writes into the git tree).
]);

function parseArgs(argv) {
  const out = {
    csv: "",
    dryRun: false,
    upload: false,
    json: false,
    out: "",
    selfName: "Tyler Lindow",
    allowReal: false,
    project: process.env.BRAINTRUST_PROJECT || "tinker-ask",
    dataset:
      process.env.BRAINTRUST_LINKEDIN_DATASET || "linkedin-replies-private",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--upload") out.upload = true;
    else if (a === "--json") out.json = true;
    else if (a === "--allow-real") out.allowReal = true;
    else if (a === "--csv") out.csv = String(argv[++i] || "").trim();
    else if (a === "--out") out.out = String(argv[++i] || "").trim();
    else if (a === "--self-name") out.selfName = String(argv[++i] || "").trim();
    else if (a === "--project") out.project = String(argv[++i] || "").trim();
    else if (a === "--dataset") out.dataset = String(argv[++i] || "").trim();
  }
  return out;
}

function assertSafeCsvPath(csvPath, { allowReal }) {
  const abs = path.resolve(csvPath);
  const base = path.basename(abs);
  const repoRoot = path.resolve(__dirname, "..");

  // Never read a file that would be committed under evals/ except the synthetic fixture.
  const synthetic = path.resolve(
    repoRoot,
    "evals/ask/fixtures/linkedin-messages.synthetic.csv",
  );
  const underEvals =
    abs.startsWith(path.resolve(repoRoot, "evals" + path.sep)) ||
    abs.startsWith(path.resolve(repoRoot, "evals/"));

  if (underEvals && abs !== synthetic) {
    throw new Error(
      `Refusing to read ${abs} under evals/ — only the synthetic fixture is allowed in-repo.\n` +
        `Use an absolute path outside the repo for a real export, and never commit it.`,
    );
  }

  if (
    !allowReal &&
    (base === "messages.csv" || /LinkedInDataExport/i.test(abs)) &&
    abs !== synthetic
  ) {
    throw new Error(
      `Refusing real LinkedIn export path without --allow-real: ${abs}\n` +
        `This loader must not be run on real data from agent/CI by default.`,
    );
  }

  if (FORBIDDEN_BASENAMES.has(base) && abs !== synthetic) {
    throw new Error(`Forbidden basename: ${base}`);
  }
  return abs;
}

function assertOutNotInGitTree(outPath) {
  if (!outPath) return;
  const abs = path.resolve(outPath);
  const repoRoot = path.resolve(__dirname, "..");
  if (abs.startsWith(repoRoot + path.sep) || abs === repoRoot) {
    // Allow only under /tmp-style or explicitly gitignored linkedin dir — still block.
    throw new Error(
      `--out must be outside the git work tree (got ${abs}). ` +
        `Anonymized LinkedIn pairs must not be committed.`,
    );
  }
}

async function uploadPrivateDataset(pairs, { project, dataset }) {
  if (!process.env.BRAINTRUST_API_KEY) {
    throw Object.assign(
      new Error(
        "BRAINTRUST_API_KEY is not set. Add it as a repo/Actions secret before --upload.",
      ),
      { code: "NO_BT_KEY" },
    );
  }
  const { initDataset } = require("braintrust");
  // Braintrust datasets are org-private by default (not publicly shareable).
  // Tag metadata so the UI/filter clearly marks this corpus as private LinkedIn gold.
  const ds = initDataset({
    project,
    dataset,
    description:
      "PRIVATE LinkedIn reply pairs (anonymized inbound → Tyler reply). Do not make public.",
    metadata: {
      visibility: "private",
      source: "linkedin-export",
      containsPiiRaw: false,
      note: "Questions are anonymized; expected is Tyler's own reply text.",
    },
  });

  for (const p of pairs) {
    ds.insert({
      id: p.id,
      input: {
        question: p.question,
        source: "linkedin",
      },
      expected: {
        tyler_answer: p.tyler_answer,
        source: "linkedin",
        category: "agreement",
      },
      tags: ["linkedin", "private", "agreement", "has_reference"],
      metadata: {
        source: "linkedin",
        category: "agreement",
        visibility: "private",
        ...(p.metadata || {}),
      },
    });
  }
  await ds.flush();
  const summary = await ds.summarize({ summarizeData: true });
  return {
    project,
    dataset,
    uploaded: pairs.length,
    datasetUrl: summary && summary.datasetUrl ? summary.datasetUrl : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.csv) {
    console.error(
      "Usage: node scripts/load-linkedin-messages.js --csv <path> [--dry-run|--upload] [--json]",
    );
    process.exit(2);
  }

  const csvPath = assertSafeCsvPath(args.csv, { allowReal: args.allowReal });
  assertOutNotInGitTree(args.out);

  if (args.upload && args.dryRun) {
    console.error("Pass only one of --upload or --dry-run.");
    process.exit(2);
  }

  const csvText = fs.readFileSync(csvPath, "utf8");
  const selfNames = [args.selfName, "Tyler"].filter(Boolean);
  const pairs = loadPairsFromCsvText(csvText, { selfNames });

  const result = {
    csv: path.basename(csvPath),
    pairs: pairs.length,
    source: "linkedin",
    dryRun: !!args.dryRun || !args.upload,
    upload: !!args.upload,
    project: args.project,
    dataset: args.dataset,
    sampleIds: pairs.slice(0, 5).map((p) => p.id),
  };

  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(
      args.out,
      pairs.map((p) => JSON.stringify(p)).join("\n") + (pairs.length ? "\n" : ""),
    );
    result.out = args.out;
  }

  if (args.upload) {
    const uploaded = await uploadPrivateDataset(pairs, {
      project: args.project,
      dataset: args.dataset,
    });
    Object.assign(result, uploaded);
    result.dryRun = false;
  }

  if (args.json) {
    // Never dump tyler_answer / question bodies to stdout in non-dry paths by default —
    // only counts + ids. Full bodies go to --out outside the repo or Braintrust.
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error(
      `linkedin pairs=${pairs.length} dryRun=${result.dryRun} upload=${!!args.upload} dataset=${args.dataset}`,
    );
    if (args.upload) {
      console.error(`uploaded to project=${args.project} dataset=${args.dataset}`);
    }
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(err && err.code === "NO_BT_KEY" ? 2 : 1);
});
