/* Mobile-viewport verify: This is everything → read-only Subject card.
 *
 * STUBBED: window.tinker.callClaude (subject JSON) and /api/leads responses.
 * Real: messages-composer / notepad / CSS path used on iPhone; KEEP_CRAFTING_MODEL.
 *
 * Writes /opt/cursor/artifacts/subject-card-hamid.png
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const ART = "/opt/cursor/artifacts";
const PORT = 4188;

const html = `<!doctype html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="stylesheet" href="/design-tokens.css"/>
<link rel="stylesheet" href="/styles.css"/>
</head>
<body class="messages-shell-open messages-mobile-thread">
<main id="messages-pane" class="messages-pane">
  <div data-messages-thread class="messages-thread messages-pane__thread"></div>
</main>
<script src="/interview-prompt.js"></script>
<script src="/messages-notepad.js"></script>
<script src="/messages-composer.js"></script>
<script>
window.tinkerMessagesShell = {
  companyForLead: function () {
    return {
      id: "cmun5x3i30008sr01xdf8uns7",
      name: "Ramp",
      domain: "ramp.com",
      notes: "Production engineering; ownership of reliability.",
    };
  },
  refresh: function () {},
};
</script>
</body></html>`;

const files = {
  "/": html,
  "/styles.css": fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8"),
  "/design-tokens.css": fs.readFileSync(path.join(root, "src/renderer/design-tokens.css"), "utf8"),
  "/interview-prompt.js": fs.readFileSync(path.join(root, "src/renderer/interview-prompt.js"), "utf8"),
  "/messages-notepad.js": fs.readFileSync(path.join(root, "src/renderer/messages-notepad.js"), "utf8"),
  "/messages-composer.js": fs.readFileSync(path.join(root, "src/renderer/messages-composer.js"), "utf8"),
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const p = url.pathname;
  if (p.startsWith("/api/leads")) {
    // Handled by Playwright route; if it reaches here, return empty.
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
    return;
  }
  if (files[p]) {
    const type = p.endsWith(".css")
      ? "text/css"
      : p.endsWith(".js")
        ? "application/javascript"
        : "text/html";
    res.writeHead(200, { "Content-Type": type + "; charset=utf-8", "Cache-Control": "no-store" });
    res.end(files[p]);
    return;
  }
  res.writeHead(404);
  res.end("missing");
});

async function main() {
  fs.mkdirSync(ART, { recursive: true });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });

  await page.route("**/api/leads**", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const action = u.searchParams.get("action") || "";
    if (req.method() === "GET" && action === "lead") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          lead: {
            id: "cmun6g1tr000711be2llfsrjo",
            personName: "Hamid Dadkhah",
            personTitle: "Head of Engineering",
            company: "Ramp",
            companyId: "cmun5x3i30008sr01xdf8uns7",
            notes: "### What do you want Hamid Dadkhah at Ramp to understand?\nReliability with ownership, not a pure people-manager seat.\n",
          },
          drafts: [],
        }),
      });
      return;
    }
    if (req.method() === "PATCH" && action === "edit") {
      const body = req.postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          lead: {
            id: "cmun6g1tr000711be2llfsrjo",
            personName: "Hamid Dadkhah",
            personTitle: "Head of Engineering",
            company: "Ramp",
            notes: body.notes || "",
          },
        }),
      });
      return;
    }
    if (req.method() === "POST" && action === "proposed-subject") {
      const body = req.postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          draft: {
            id: "draft-hamid",
            channel: "gmail_outreach",
            subject: body.subject,
            body: "",
            status: "draft",
            leadId: "cmun6g1tr000711be2llfsrjo",
          },
          lead: {
            id: "cmun6g1tr000711be2llfsrjo",
            personName: "Hamid Dadkhah",
            company: "Ramp",
          },
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.addInitScript(() => {
    localStorage.setItem("tinker_jwt", "e2e_session_placeholder");
    window.tinker = {
      callClaude: async () => ({
        text: JSON.stringify({
          subject: "Reliability with ownership — a note for Hamid at Ramp",
        }),
      }),
      supportsWebview: false,
    };
  });

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!(window.tinkerMessagesComposer && window.tinkerMessagesNotepad && window.tinkerInterview));
  await page.evaluate(() => {
    window.tinkerMessagesComposer.setLead(
      "cmun6g1tr000711be2llfsrjo",
      {
        id: "cmun6g1tr000711be2llfsrjo",
        personName: "Hamid Dadkhah",
        personTitle: "Head of Engineering",
        company: "Ramp",
        companyId: "cmun5x3i30008sr01xdf8uns7",
        notes: "### What do you want Hamid Dadkhah at Ramp to understand?\nReliability with ownership, not a pure people-manager seat.\n",
      },
      null,
      [],
    );
  });
  await page.waitForSelector("[data-notepad-primary]");
  await page.fill("[data-notepad-input]", "I want him to see I stay close to the incident path.");
  await page.click("[data-notepad-primary]");
  await page.waitForSelector("[data-notepad-subject]", { timeout: 15000 });
  const subject = await page.textContent(".messages-notepad__subject-text");
  const inputHidden = await page.evaluate(() => {
    const input = document.querySelector("[data-notepad-input]");
    return !input || input.hidden === true || input.offsetParent === null;
  });
  const footHidden = await page.evaluate(() => {
    const foot = document.querySelector("[data-notepad-foot]");
    return !foot || foot.hidden === true || foot.offsetParent === null;
  });
  await page.screenshot({ path: path.join(ART, "subject-card-hamid.png"), fullPage: true });
  const report = {
    subject: String(subject || "").trim(),
    inputHidden,
    footHidden,
    stubbed: ["window.tinker.callClaude", "/api/leads"],
    real: [
      "messages-composer Subject card path",
      "iPhone viewport 390×844",
      "KEEP_CRAFTING_MODEL from interview-prompt.js",
    ],
  };
  fs.writeFileSync(path.join(ART, "subject-card-hamid.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.subject || !report.inputHidden || !report.footHidden) process.exit(1);
  await browser.close();
  server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
