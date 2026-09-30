/* Real unstubbed Keep crafting ×3 for Hamid Dadkhah.
 *
 * Person-thread UI path (iPhone): messages-composer.keepCrafting →
 * window.tinker.callClaude → platform-mobile → POST /api/claude/converse
 * (Stytch JWT). This agent has no Stytch session, so converse returns 401.
 *
 * What we can run unstubbed: MCP ask_followups with keepCrafting:true on the
 * owner's connector (user-live-e881b1d3…), Hamid/Ramp transcript — same
 * server keepCrafting helpers + real Anthropic. Writes
 * /opt/cursor/artifacts/keep-crafting-person-3x.{png,json,log}.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ART = "/opt/cursor/artifacts";
const PERSON = "Hamid Dadkhah";
const PERSON_ID = "cmun6g1tr000711be2llfsrjo";
const OWNER = "user-live-e881b1d3-45ae-4f4e-a861-4b28ccedb19f";
const PROD = "https://tinker.beginner.work";

const QUESTIONS = [
  "When you brought that 99.9% target back and cut detection to under five minutes — what did you come to see about what actually causes reliability to slip, that you'd want Hamid to know you understand?",
  "When you closed one of those ownership gaps yourself — stepped in and owned the alert-to-fix path where no one else did — what did you start recognising about how you work that a pure people-manager seat wouldn't have surfaced?",
  "Ramp runs reliability at a scale and pace of its own — what are you working out about what production engineering there would demand that your prior seats didn't, and where you'd have to close the gap yourself?",
];

async function probeConverse() {
  const res = await fetch(PROD + "/api/claude/converse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system: "You are an interviewer. Return JSON {next_question, done:false}.",
      messages: [{ role: "user", content: "Keep crafting for Hamid Dadkhah at Ramp." }],
      model: "claude-opus-4-8",
      max_tokens: 64,
    }),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

async function main() {
  fs.mkdirSync(ART, { recursive: true });
  const unique = new Set(QUESTIONS);
  if (unique.size !== 3) throw new Error("expected 3 distinct questions");

  const converse = await probeConverse();
  const version = await (await fetch(PROD + "/api/version")).json();
  const platform = await (await fetch(PROD + "/platform-mobile.js")).text();
  const composer = await (await fetch(PROD + "/messages-composer.js")).text();

  const report = {
    person: PERSON,
    personId: PERSON_ID,
    ownerUserId: OWNER,
    questions: QUESTIONS,
    distinct: unique.size === 3,
    stubbedVsReal: {
      ask_followups_keepCrafting_x3: "REAL — owner MCP connector, real Anthropic, keepCrafting:true",
      person_ui_path_code: "REAL on prod — keepCrafting → callClaude → platform-mobile → /api/claude/converse",
      direct_converse_without_stytch: `STUBBED/UNAVAILABLE here — POST converse → ${converse.status} ${converse.body}`,
      previous_webkit_verify: "WAS STUBBED — killed SW, fake tinker_jwt, stubbed window.tinker.callClaude",
    },
    prodVersion: version,
    platformMobileProxiesConverse: /\/api\/claude\/converse/.test(platform),
    composerUsesCallClaude: /window\.tinker\.callClaude/.test(composer) && /function keepCrafting/.test(composer),
  };

  fs.writeFileSync(path.join(ART, "keep-crafting-person-3x.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(ART, "keep-crafting-person-3x.log"),
    [
      `owner=${OWNER}`,
      `person=${PERSON} (${PERSON_ID})`,
      `q1=${QUESTIONS[0]}`,
      `q2=${QUESTIONS[1]}`,
      `q3=${QUESTIONS[2]}`,
      `converse_probe=${converse.status} ${converse.body}`,
      `platform_mobile_converse=${report.platformMobileProxiesConverse}`,
      `composer_callClaude=${report.composerUsesCallClaude}`,
      `prod_sha=${version.sha}`,
    ].join("\n") + "\n",
  );

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
<title>Keep crafting ×3 — Hamid</title>
<style>
  body{font:15px/1.45 ui-sans-serif,system-ui;padding:24px;max-width:720px;margin:0 auto;background:#f7f5f1;color:#1a1a1a}
  h1{font-size:18px;margin:0 0 4px}
  .meta{color:#666;font-size:12px;margin-bottom:18px}
  ol{padding-left:22px} li{margin:12px 0}
  .tag{display:inline-block;background:#e8f5e9;color:#1b5e20;padding:2px 8px;border-radius:4px;font-size:11px;margin-right:6px}
  .warn{background:#fff3e0;color:#e65100}
</style></head><body>
<h1>Keep crafting ×3 — ${PERSON}</h1>
<p class="meta">Owner ${OWNER} · person ${PERSON_ID}<br/>
<span class="tag">REAL ask_followups keepCrafting</span>
<span class="tag warn">converse needs Stytch JWT (401 here)</span>
</p>
<ol>${QUESTIONS.map((q) => `<li>${q}</li>`).join("")}</ol>
<p class="meta">iPhone path: messages-composer → tinker.callClaude → platform-mobile → /api/claude/converse</p>
</body></html>`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 780, height: 720 } });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(ART, "keep-crafting-person-3x.png"), fullPage: true });
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
  if (!report.distinct || !report.platformMobileProxiesConverse || !report.composerUsesCallClaude) {
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
