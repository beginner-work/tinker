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

# The Vision

> *A place where founders go to find themselves through writing — the rainbow-web reshaping what writing-for-yourself looks like.*

> *A world where everyone building something has somewhere to think through who they are.*

---

<!-- _class: tinker title-only -->

<div class="tinker-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none" role="img" aria-label="tinker rainbow-web mark"><rect width="200" height="200" rx="44" fill="#F5F3EF"/><circle cx="100" cy="100" r="76" fill="none" stroke="#C8B6E2" stroke-width="9"/><line x1="24.06" y1="62.00" x2="175.94" y2="62.00" stroke="#F9A8D4" stroke-width="9" stroke-linecap="round"/><line x1="24.00" y1="100.00" x2="176.00" y2="100.00" stroke="#FDBA74" stroke-width="9" stroke-linecap="round"/><line x1="24.06" y1="138.00" x2="175.94" y2="138.00" stroke="#FDE68A" stroke-width="9" stroke-linecap="round"/><ellipse cx="100" cy="100" rx="52" ry="76" fill="none" stroke="#7BC47A" stroke-width="9"/><ellipse cx="100" cy="100" rx="26" ry="76" fill="none" stroke="#7DD3FC" stroke-width="9"/><line x1="100" y1="24" x2="100" y2="176" stroke="#6EE7B7" stroke-width="9" stroke-linecap="round"/></svg>
<span class="wm">tinker</span>
</div>
<div class="tinker-rainbow"></div>

# The Product

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

# The Moat

> *Your ideas are woven together with other founders on the platform.*

> *You come because they have what you need, and you stay because everyone's there.*

---

<!-- _class: statement -->

# Competition

meta

---

# The Ask

> *Pre-seed: $250k – $950k.*

---

<!-- _class: closing -->

# Thank you
