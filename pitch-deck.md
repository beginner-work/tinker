---
marp: true
theme: default
paginate: true
size: 16:9
backgroundColor: "#fffdf7"
color: "#2d2a26"
style: |
  @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap");

  section {
    font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #fffdf7;
    color: #2d2a26;
    padding: 128px 112px 80px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    font-size: 22px;
    line-height: 1.55;
  }

  h1, h2, h3 {
    font-family: "Plus Jakarta Sans", "Inter", sans-serif;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #2d2a26;
    margin: 0 0 0.5em;
  }

  section > h1 {
    font-size: 56px;
    line-height: 1.05;
    margin: 0 0 40px;
  }

  blockquote {
    border-left: 3px solid #ede8e0;
    color: #2d2a26;
    font-size: 30px;
    line-height: 1.5;
    margin: 0 0 26px;
    padding: 0 0 0 28px;
    font-style: normal;
    quotes: none;
  }
  blockquote::before, blockquote::after { content: none; }
  blockquote p { margin: 0; }

  strong { color: #1a1a1a; font-weight: 700; }
  em { font-style: italic; color: #2d2a26; }

  section::after {
    font-family: "Inter", sans-serif;
    font-size: 11px;
    color: #6f6a65;
    letter-spacing: 0.08em;
  }

  /* Cover slide — beginner (company) brand */
  section.cover { padding: 96px 112px; }
  section.cover .lockup {
    display: flex;
    align-items: center;
    gap: 24px;
    margin: 0 0 44px;
  }
  section.cover .lockup svg { width: 108px; height: 108px; }
  section.cover .lockup .wm {
    font-family: "Plus Jakarta Sans", "Inter", sans-serif;
    font-weight: 800;
    font-size: 92px;
    letter-spacing: -0.04em;
    color: #2d5a3d;
    line-height: 1;
  }
  section.cover h1 { display: none; }
  section.cover .tagline {
    font-family: "Plus Jakarta Sans", "Inter", sans-serif;
    font-weight: 700;
    font-size: 44px;
    line-height: 1.15;
    letter-spacing: -0.02em;
    color: #2d2a26;
    margin: 0 0 8px;
    max-width: 900px;
  }
  section.cover .meta {
    margin-top: 64px;
    padding-top: 18px;
    border-top: 1px solid #ede8e0;
    font-size: 14px;
    color: #6f6a65;
    letter-spacing: 0.02em;
    line-height: 1.75;
  }

  /* Tinker product slides — rainbow-web brand */
  section.tinker { padding-top: 144px; }
  section.tinker .tinker-badge {
    position: absolute;
    top: 56px;
    left: 112px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  section.tinker .tinker-badge svg { width: 36px; height: 36px; }
  section.tinker .tinker-badge .wm {
    font-family: "Plus Jakarta Sans", "Inter", sans-serif;
    font-weight: 700;
    font-size: 18px;
    letter-spacing: -0.01em;
    color: #2d2a26;
  }
  section.tinker .tinker-rainbow {
    position: absolute;
    top: 70px;
    right: 112px;
    width: 200px;
    height: 6px;
    background: linear-gradient(90deg, #f9a8d4 0%, #fdba74 18%, #fde68a 36%, #7bc47a 55%, #7dd3fc 75%, #c4b5fd 100%);
    border-radius: 999px;
  }
  section.tinker blockquote { border-left: 3px solid #c8b6e2; }
  section.tinker blockquote + blockquote { border-left-color: #7dd3fc; }

  /* Title-only slide — h1 centered, oversized */
  section.title-only { justify-content: center; }
  section.title-only > h1 {
    font-size: 96px;
    text-align: center;
    margin: 0;
    line-height: 1;
  }

  /* Statement slide — title + one-word punch */
  section.statement > p {
    font-family: "Plus Jakarta Sans", "Inter", sans-serif;
    font-weight: 700;
    font-size: 88px;
    letter-spacing: -0.03em;
    color: #2d2a26;
    margin: 0;
    line-height: 1;
  }

  /* Closing — centered "Thank you" */
  section.closing { justify-content: center; align-items: center; padding-top: 80px; }
  section.closing > h1 {
    font-size: 96px;
    text-align: center;
    margin: 0;
    color: #2d5a3d;
    line-height: 1;
  }

  /* Product slide — inline SVG screenshot */
  .product-shot {
    display: block;
    width: 100%;
    max-width: 1056px;
    height: auto;
    margin: 8px auto 0;
    filter: drop-shadow(0 16px 32px rgba(45, 42, 38, 0.18));
  }

  /* Competition slide — Meta logo mark */
  .meta-logo {
    display: block;
    width: 380px;
    height: auto;
    margin: 0;
  }

  /* Ask slide — funding breakdown */
  section.ask blockquote { margin-bottom: 36px; }
  section.ask p.min-line {
    font-size: 24px;
    line-height: 1.4;
    margin: 0 0 18px;
  }
  section.ask p.min-line strong {
    font-family: "Plus Jakarta Sans", "Inter", sans-serif;
    color: #2d5a3d;
  }
  section.ask p.incr-lead {
    font-size: 20px;
    color: #6f6a65;
    margin: 0 0 12px;
  }
  section.ask ul {
    font-size: 22px;
    line-height: 1.55;
    margin: 0;
    padding: 0 0 0 24px;
  }
  section.ask ul li { margin-bottom: 4px; }
---

<!--
Export to PDF: npx @marp-team/marp-cli@latest pitch-deck.md --pdf --html
-->

<!-- _class: cover -->

<div class="lockup">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# beginner

<p class="tagline">Everyone is a founder</p>

<div class="meta">

Tyler Lindow · Founder & CEO of beginner<br>
Pre-seed · $250k – $950k

</div>

---

# The Problem

> *Do you feel like you've worked so hard, but you're still finding yourself stressed about what you're doing?*

> *You thought that this next life change would be the one, but it feels like you're doing the same thing again.*

---

# The Problem

> *John is 31. He's a dad. He goes to school full time. He's a recovering AI engineer, and he's quite progressive when it comes to considering men's mental health.*

> *John is seeking extreme wealth. He knows it's there. He just hasn't tapped it yet, and that's everything.*

---

# Why Now?

> *AI is making our workplace more toxic. The sprint towards figuring out what we can do is insane right now.*

> *People, including myself, need a tool that can help them figure out who they are as a founder.*

---

<!-- _class: tinker -->

<div class="tinker-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none" role="img" aria-label="tinker rainbow-web mark"><rect width="200" height="200" rx="44" fill="#F5F3EF"/><circle cx="100" cy="100" r="76" fill="none" stroke="#C8B6E2" stroke-width="9"/><line x1="24.06" y1="62.00" x2="175.94" y2="62.00" stroke="#F9A8D4" stroke-width="9" stroke-linecap="round"/><line x1="24.00" y1="100.00" x2="176.00" y2="100.00" stroke="#FDBA74" stroke-width="9" stroke-linecap="round"/><line x1="24.06" y1="138.00" x2="175.94" y2="138.00" stroke="#FDE68A" stroke-width="9" stroke-linecap="round"/><ellipse cx="100" cy="100" rx="52" ry="76" fill="none" stroke="#7BC47A" stroke-width="9"/><ellipse cx="100" cy="100" rx="26" ry="76" fill="none" stroke="#7DD3FC" stroke-width="9"/><line x1="100" y1="24" x2="100" y2="176" stroke="#6EE7B7" stroke-width="9" stroke-linecap="round"/></svg>
<span class="wm">tinker</span>
</div>
<div class="tinker-rainbow"></div>

# The Product

<svg class="product-shot" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1100 400" role="img" aria-label="tinker product screenshot"><rect x="1" y="1" width="1098" height="398" rx="18" fill="#fffdf7" stroke="#ede8e0" stroke-width="1"/><line x1="260" y1="20" x2="260" y2="380" stroke="#ede8e0" stroke-width="1"/><g font-family="Inter, system-ui, sans-serif" fill="#2d2a26"><g transform="translate(24, 22) scale(0.1)"><rect width="200" height="200" rx="44" fill="#F5F3EF"/><circle cx="100" cy="100" r="76" fill="none" stroke="#C8B6E2" stroke-width="9"/><line x1="24.06" y1="62" x2="175.94" y2="62" stroke="#F9A8D4" stroke-width="9" stroke-linecap="round"/><line x1="24" y1="100" x2="176" y2="100" stroke="#FDBA74" stroke-width="9" stroke-linecap="round"/><line x1="24.06" y1="138" x2="175.94" y2="138" stroke="#FDE68A" stroke-width="9" stroke-linecap="round"/><ellipse cx="100" cy="100" rx="52" ry="76" fill="none" stroke="#7BC47A" stroke-width="9"/><ellipse cx="100" cy="100" rx="26" ry="76" fill="none" stroke="#7DD3FC" stroke-width="9"/><line x1="100" y1="24" x2="100" y2="176" stroke="#6EE7B7" stroke-width="9" stroke-linecap="round"/></g><text x="52" y="36" font-family="Plus Jakarta Sans, Inter" font-size="14" font-weight="700">tinker</text><text x="24" y="72" font-size="9" letter-spacing="1.2" fill="#6f6a65">PITCH PROGRESS</text><text x="236" y="72" font-size="9" text-anchor="end" fill="#6f6a65">4 / 7</text><rect x="24" y="78" width="212" height="3" rx="1.5" fill="#ede8e0"/><rect x="24" y="78" width="121" height="3" rx="1.5" fill="#6366f1"/><text x="24" y="106" font-family="Plus Jakarta Sans, Inter" font-size="11" font-weight="700">1.  The Problem</text><text x="24" y="122" font-size="9.5" fill="#6f6a65">I want to go into the office as</text><text x="24" y="134" font-size="9.5" fill="#6f6a65">easily as a home office</text><text x="24" y="160" font-family="Plus Jakarta Sans, Inter" font-size="11" font-weight="700">3.  The Product</text><text x="24" y="176" font-size="9.5" fill="#6f6a65">I can write for myself</text><text x="24" y="202" font-family="Plus Jakarta Sans, Inter" font-size="11" font-weight="700">5.  The Moat</text><text x="24" y="218" font-size="9.5" fill="#6f6a65">my content and writing verbatim</text><text x="24" y="244" font-family="Plus Jakarta Sans, Inter" font-size="11" font-weight="700">7.  The Ask</text><text x="24" y="260" font-size="9.5" fill="#6f6a65">ready to launch and submit my</text><text x="24" y="272" font-size="9.5" fill="#6f6a65">funding applications</text><line x1="24" y1="310" x2="236" y2="310" stroke="#ede8e0" stroke-width="1"/><text x="24" y="326" font-size="9" letter-spacing="1.2" fill="#6f6a65">ACCOUNT</text><rect x="24" y="341" width="10" height="12" rx="1.5" fill="none" stroke="#2d2a26" stroke-width="1.2"/><line x1="27" y1="345" x2="32" y2="345" stroke="#2d2a26" stroke-width="1"/><line x1="27" y1="348" x2="32" y2="348" stroke="#2d2a26" stroke-width="1"/><text x="42" y="350" font-size="11" fill="#2d2a26">Receipts</text><path d="M24 366 L24 372 L34 372 L34 366 M29 369 L29 360 M26 363 L29 360 L32 363" fill="none" stroke="#2d2a26" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><text x="42" y="370" font-size="11" fill="#2d2a26">Share tinker</text></g><polygon points="260,20 440,20 260,200" fill="#6366f1"/><g text-anchor="middle"><g transform="translate(652, 58) scale(0.26)"><circle cx="100" cy="100" r="76" fill="none" stroke="#C8B6E2" stroke-width="9"/><line x1="24.06" y1="62" x2="175.94" y2="62" stroke="#F9A8D4" stroke-width="9" stroke-linecap="round"/><line x1="24" y1="100" x2="176" y2="100" stroke="#FDBA74" stroke-width="9" stroke-linecap="round"/><line x1="24.06" y1="138" x2="175.94" y2="138" stroke="#FDE68A" stroke-width="9" stroke-linecap="round"/><ellipse cx="100" cy="100" rx="52" ry="76" fill="none" stroke="#7BC47A" stroke-width="9"/><ellipse cx="100" cy="100" rx="26" ry="76" fill="none" stroke="#7DD3FC" stroke-width="9"/><line x1="100" y1="24" x2="100" y2="176" stroke="#6EE7B7" stroke-width="9" stroke-linecap="round"/></g><text x="680" y="158" font-family="Plus Jakarta Sans, Inter" font-size="30" font-weight="700" fill="#2d2a26">Everyone is a founder.</text><text x="680" y="184" font-family="Inter" font-size="13" fill="#6f6a65">You just need a seed to start.</text><text x="680" y="226" font-family="Inter" font-size="13" font-weight="600" fill="#2d2a26">Where are you right now?</text><rect x="480" y="244" width="180" height="40" rx="10" fill="#fffdf7" stroke="#ede8e0" stroke-width="1"/><text x="570" y="269" font-family="Inter" font-size="13" font-weight="600" fill="#2d2a26">Cafe</text><rect x="700" y="244" width="180" height="40" rx="10" fill="#fffdf7" stroke="#ede8e0" stroke-width="1"/><text x="790" y="269" font-family="Inter" font-size="13" font-weight="600" fill="#2d2a26">Home</text><rect x="480" y="296" width="180" height="40" rx="10" fill="#fffdf7" stroke="#ede8e0" stroke-width="1"/><text x="570" y="321" font-family="Inter" font-size="13" font-weight="600" fill="#2d2a26">Work</text><rect x="700" y="296" width="180" height="40" rx="10" fill="#fffdf7" stroke="#ede8e0" stroke-width="1"/><text x="790" y="321" font-family="Inter" font-size="13" font-weight="600" fill="#2d2a26">Somewhere else</text></g></svg>

---

<!-- _class: tinker -->

<div class="tinker-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none" role="img" aria-label="tinker rainbow-web mark"><rect width="200" height="200" rx="44" fill="#F5F3EF"/><circle cx="100" cy="100" r="76" fill="none" stroke="#C8B6E2" stroke-width="9"/><line x1="24.06" y1="62.00" x2="175.94" y2="62.00" stroke="#F9A8D4" stroke-width="9" stroke-linecap="round"/><line x1="24.00" y1="100.00" x2="176.00" y2="100.00" stroke="#FDBA74" stroke-width="9" stroke-linecap="round"/><line x1="24.06" y1="138.00" x2="175.94" y2="138.00" stroke="#FDE68A" stroke-width="9" stroke-linecap="round"/><ellipse cx="100" cy="100" rx="52" ry="76" fill="none" stroke="#7BC47A" stroke-width="9"/><ellipse cx="100" cy="100" rx="26" ry="76" fill="none" stroke="#7DD3FC" stroke-width="9"/><line x1="100" y1="24" x2="100" y2="176" stroke="#6EE7B7" stroke-width="9" stroke-linecap="round"/></svg>
<span class="wm">tinker</span>
</div>
<div class="tinker-rainbow"></div>

# How We Make Money

> *Word of mouth is the biggest distribution model. Free to start, $7 a month once they use it enough.*

> *Various tiers of monthly subscriptions to get deeper into the writing tools.*

---

<!-- _class: tinker -->

<div class="tinker-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none" role="img" aria-label="tinker rainbow-web mark"><rect width="200" height="200" rx="44" fill="#F5F3EF"/><circle cx="100" cy="100" r="76" fill="none" stroke="#C8B6E2" stroke-width="9"/><line x1="24.06" y1="62.00" x2="175.94" y2="62.00" stroke="#F9A8D4" stroke-width="9" stroke-linecap="round"/><line x1="24.00" y1="100.00" x2="176.00" y2="100.00" stroke="#FDBA74" stroke-width="9" stroke-linecap="round"/><line x1="24.06" y1="138.00" x2="175.94" y2="138.00" stroke="#FDE68A" stroke-width="9" stroke-linecap="round"/><ellipse cx="100" cy="100" rx="52" ry="76" fill="none" stroke="#7BC47A" stroke-width="9"/><ellipse cx="100" cy="100" rx="26" ry="76" fill="none" stroke="#7DD3FC" stroke-width="9"/><line x1="100" y1="24" x2="100" y2="176" stroke="#6EE7B7" stroke-width="9" stroke-linecap="round"/></svg>
<span class="wm">tinker</span>
</div>
<div class="tinker-rainbow"></div>

# Go to Market

> *I show up where they already are — LinkedIn, and incubators in San Diego or San Francisco.*

> *I need help from a startup incubator making the connections and explaining the playbook nationally.*

---

<!-- _class: tinker -->

<div class="tinker-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none" role="img" aria-label="tinker rainbow-web mark"><rect width="200" height="200" rx="44" fill="#F5F3EF"/><circle cx="100" cy="100" r="76" fill="none" stroke="#C8B6E2" stroke-width="9"/><line x1="24.06" y1="62.00" x2="175.94" y2="62.00" stroke="#F9A8D4" stroke-width="9" stroke-linecap="round"/><line x1="24.00" y1="100.00" x2="176.00" y2="100.00" stroke="#FDBA74" stroke-width="9" stroke-linecap="round"/><line x1="24.06" y1="138.00" x2="175.94" y2="138.00" stroke="#FDE68A" stroke-width="9" stroke-linecap="round"/><ellipse cx="100" cy="100" rx="52" ry="76" fill="none" stroke="#7BC47A" stroke-width="9"/><ellipse cx="100" cy="100" rx="26" ry="76" fill="none" stroke="#7DD3FC" stroke-width="9"/><line x1="100" y1="24" x2="100" y2="176" stroke="#6EE7B7" stroke-width="9" stroke-linecap="round"/></svg>
<span class="wm">tinker</span>
</div>
<div class="tinker-rainbow"></div>

# The Moat

> *Your ideas are woven together with other founders on the platform.*

> *You come because they have what you need, and you stay because everyone's there.*

---

<!-- _class: tinker -->

<div class="tinker-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none" role="img" aria-label="tinker rainbow-web mark"><rect width="200" height="200" rx="44" fill="#F5F3EF"/><circle cx="100" cy="100" r="76" fill="none" stroke="#C8B6E2" stroke-width="9"/><line x1="24.06" y1="62.00" x2="175.94" y2="62.00" stroke="#F9A8D4" stroke-width="9" stroke-linecap="round"/><line x1="24.00" y1="100.00" x2="176.00" y2="100.00" stroke="#FDBA74" stroke-width="9" stroke-linecap="round"/><line x1="24.06" y1="138.00" x2="175.94" y2="138.00" stroke="#FDE68A" stroke-width="9" stroke-linecap="round"/><ellipse cx="100" cy="100" rx="52" ry="76" fill="none" stroke="#7BC47A" stroke-width="9"/><ellipse cx="100" cy="100" rx="26" ry="76" fill="none" stroke="#7DD3FC" stroke-width="9"/><line x1="100" y1="24" x2="100" y2="176" stroke="#6EE7B7" stroke-width="9" stroke-linecap="round"/></svg>
<span class="wm">tinker</span>
</div>
<div class="tinker-rainbow"></div>

# The Vision

> *Eventually, it's just the way that people do invest in each other. "Hey, are you on Tinker?"*

> *A two-sided marketplace and a payment network at the same time, and a social network — for the types of craft and the types of founders that have traditionally not been funded.*

---

<!-- _class: statement -->

# Competition

<svg class="meta-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 120" role="img" aria-label="Meta"><defs><linearGradient id="metaG" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#0081FB"/><stop offset="50%" stop-color="#0273E6"/><stop offset="100%" stop-color="#0064E0"/></linearGradient></defs><path d="M 50 60 C 50 20, 100 20, 130 60 C 160 100, 210 100, 210 60 C 210 20, 160 20, 130 60 C 100 100, 50 100, 50 60 Z" fill="none" stroke="url(#metaG)" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/></svg>

---

<!-- _class: ask -->

# The Ask

> *Pre-seed: $250k – $950k.*

<p class="min-line"><strong>$250k</strong> — the minimum: founder's salary so I can keep building full-time.</p>

<p class="incr-lead">Each increment above that just speeds it all up:</p>

- Marketing
- Travel costs
- Product investments to speed up development
- Cloud infrastructure costs

---

<!-- _class: closing -->

# Thank you
