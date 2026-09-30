/* iPhone 390×844 verify: person header wrap + no Notes-for chrome.
 *
 * REAL: person/company copy from live MCP list_target_companies (Faria/Hamid).
 * STUBBED: Stytch session /api/leads (no TEST_AUTH_TOKEN here) — mounts the
 * real messages-pane header + notepad opening with that live lead payload.
 *
 * mode=before → fetch prod CSS/JS/HTML fragments (current shipped cut).
 * mode=after  → serve workspace renderer (this branch).
 *
 * Writes /opt/cursor/artifacts/person-header-{before,after}-{faria,hamid}.png
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const ART = "/opt/cursor/artifacts";
const PORT = 4191;
const PROD = "https://tinker.beginner.work";
const mode = process.argv[2] === "before" ? "before" : "after";

const PEOPLE = [
  {
    key: "faria",
    lead: {
      id: "cmun6gqfw0009rekct3yx4bfj",
      personName: "Faria Chaudhry",
      personTitle: "Senior Technical Recruiter II",
      company: "Alloy",
      companyId: "cmun5x3jl000bsr01ydujq9df",
      linkedInUrl: "https://www.linkedin.com/in/fariachaudhry/",
      notes:
        "### What do you want Faria Chaudhry at Alloy to understand about you?\nNot sure",
    },
    company: {
      id: "cmun5x3jl000bsr01ydujq9df",
      name: "Alloy",
      domain: "alloy.com",
      notes:
        "Alloy's Developer Experience team owns the Events API, the webhooks and the partner feeds, the same surface you spent years making dependable at Affirm. You grew that developer support team from one engineer to nine, and you know what makes a platform easy or painful to build on. The catch is that they want someone in New York three days a week.",
      research: "",
    },
  },
  {
    key: "hamid",
    lead: {
      id: "cmun6g1tr000711be2llfsrjo",
      personName: "Hamid Dadkhah",
      personTitle: "Head of Engineering",
      company: "Ramp",
      companyId: "cmun5x3i30008sr01xdf8uns7",
      linkedInUrl: "https://www.linkedin.com/in/hdadkhah/",
      notes:
        "### What do you want Hamid Dadkhah at Ramp to understand about you?\nTake a chance\n\n### When you brought that missed 99.9% target back and started catching merchant outages in under five minutes, what did you learn about how you actually work under that kind of pressure — something Hamid should recognise in you?\nI’m a natural leader. I enjoy taking care of things.\n\n### Taking care of things until a missed target came back and outages got caught in under five minutes — what were you finding out about the gap between managing people and actually owning reliability, the kind of ownership Hamid's production team lives on?\nReliability, much like managing people, requires systems in place. We will always be creative, and so to create an environment for consistent reliability, we have to make it second nature",
    },
    company: {
      id: "cmun5x3i30008sr01xdf8uns7",
      name: "Ramp",
      domain: "ramp.com",
      notes:
        "Ramp's production engineering team owns reliability across the whole company, which is the work you did bringing a missed 99.9% availability target back and catching merchant outages in under five minutes. It's a hands-on tech lead seat, and word is Ramp rarely hires managers from outside. So the first move is a conversation to see if there's a real path in.",
      research: "",
    },
  },
];

async function loadAsset(rel) {
  if (mode === "after") {
    return fs.readFileSync(path.join(root, "src/renderer", rel), "utf8");
  }
  const res = await fetch(PROD + "/" + rel.replace(/^\//, ""));
  if (!res.ok) throw new Error("prod " + rel + " " + res.status);
  return await res.text();
}

function pageHtml(assets) {
  // Minimal shell matching prod mobile person thread chrome.
  return `<!doctype html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<link rel="stylesheet" href="/design-tokens.css"/>
<link rel="stylesheet" href="/styles.css"/>
<style>
  html, body { margin: 0; background: var(--color-background, #f7f5f1); }
  body { min-height: 100vh; }
</style>
</head>
<body class="messages-shell-open messages-inbox-primary messages-thread-active messages-mobile-thread messages-notepad-active">
<section id="messages-pane" class="messages-pane" aria-label="Conversation">
  <header class="messages-pane__top">
    <div class="messages-pane__lead" data-messages-lead>
      <button type="button" class="messages-pane__menu" data-messages-menu
              aria-label="Open conversations" style="display:inline-flex">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
          <path d="M5 8h14M5 12h10M5 16h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
      <button type="button" class="messages-pane__back" data-messages-back
              aria-label="Back to conversations" style="display:inline-block">←</button>
      <span class="messages-pane__avatar" data-messages-avatar hidden aria-hidden="true"></span>
      <h2 class="messages-pane__title">${
        mode === "after"
          ? `<span class="messages-pane__name" data-messages-name>Messages</span>
             <span class="messages-pane__role" data-messages-role hidden></span>`
          : `<span data-messages-name>Messages</span><span class="messages-pane__role" data-messages-role hidden></span>`
      }</h2>
    </div>
    <div class="messages-pane__links" data-messages-links hidden></div>
  </header>
  <div class="messages-pane__body">
    <div class="messages-pane__thread" data-messages-thread></div>
  </div>
</section>
<script src="/interview-prompt.js"></script>
<script src="/messages-notepad.js"></script>
<script src="/messages-composer.js"></script>
<script>
window.__VERIFY_ASSETS__ = ${JSON.stringify({ mode })};
</script>
</body></html>`;
}

async function main() {
  fs.mkdirSync(ART, { recursive: true });
  const assets = {
    "styles.css": await loadAsset("styles.css"),
    "design-tokens.css": await loadAsset("design-tokens.css"),
    "interview-prompt.js": await loadAsset("interview-prompt.js"),
    "messages-notepad.js": await loadAsset("messages-notepad.js"),
    "messages-composer.js": await loadAsset("messages-composer.js"),
  };
  // Prod before may still have old header markup served from index; we emulate
  // that single-line title span shape in pageHtml when mode=before.

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const p = url.pathname;
    if (p === "/" || p === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(pageHtml(assets));
      return;
    }
    const key = p.replace(/^\//, "");
    if (assets[key]) {
      const type = key.endsWith(".css") ? "text/css" : "application/javascript";
      res.writeHead(200, { "Content-Type": type + "; charset=utf-8", "Cache-Control": "no-store" });
      res.end(assets[key]);
      return;
    }
    res.writeHead(404);
    res.end("missing");
  });

  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const browser = await chromium.launch({ headless: true });
  const iphone = devices["iPhone 13"];
  const report = { mode, stubbed: ["Stytch /api/leads auth"], real: ["MCP lead/company copy for Faria + Hamid"], shots: [] };

  for (const person of PEOPLE) {
    const context = await browser.newContext({
      ...iphone,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });

    await page.evaluate((payload) => {
      const { lead, company } = payload;
      const nameEl = document.querySelector("[data-messages-name]");
      const role = document.querySelector("[data-messages-role]");
      const avatar = document.querySelector("[data-messages-avatar]");
      if (nameEl) nameEl.textContent = lead.personName;
      if (role) {
        const bits = [];
        if (lead.personTitle) bits.push(lead.personTitle);
        if (lead.company) bits.push("at " + lead.company);
        const line = bits.join(" ");
        // Mirror prod before (middle-dot) vs after (second line, no dot).
        const after = !!(window.__VERIFY_ASSETS__ && window.__VERIFY_ASSETS__.mode === "after");
        role.hidden = !line;
        role.textContent = line ? (after ? line : " · " + line) : "";
      }
      if (avatar) {
        avatar.hidden = false;
        avatar.innerHTML = "";
        const img = document.createElement("img");
        img.src = "https://icons.duckduckgo.com/ip3/" + company.domain + ".ico";
        img.width = 22;
        img.height = 22;
        img.alt = "";
        avatar.appendChild(img);
      }
      window.tinkerMessagesShell = {
        companyForLead: function () { return company; },
        refresh: function () {},
      };
      if (window.tinkerMessagesComposer && typeof window.tinkerMessagesComposer.setLead === "function") {
        window.tinkerMessagesComposer.setLead(lead.id, lead, null);
      }
    }, person);

    await page.waitForTimeout(400);
    const shot = path.join(ART, `person-header-${mode}-${person.key}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    const metrics = await page.evaluate(() => {
      const title = document.querySelector(".messages-pane__title");
      const role = document.querySelector("[data-messages-role]");
      const name = document.querySelector("[data-messages-name]");
      const context = document.querySelector(".messages-notepad__context");
      const research = document.querySelector(".messages-notepad__research");
      const q = document.querySelector("[data-notepad-question], .messages-notepad__question");
      const tr = title ? title.getBoundingClientRect() : null;
      const overflowRight = tr ? tr.right > window.innerWidth - 2 : null;
      return {
        name: name && name.textContent,
        role: role && role.textContent,
        titleHeight: tr && tr.height,
        overflowRight,
        hasContext: !!context,
        hasResearch: !!research,
        firstQuestion: q && q.textContent,
      };
    });
    report.shots.push({ person: person.key, file: shot, metrics });
    await context.close();
  }

  await browser.close();
  server.close();
  const out = path.join(ART, `person-header-${mode}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
