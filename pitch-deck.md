---
marp: true
theme: portrait
paginate: true
backgroundColor: "#fffdf7"
color: "#2d2a26"
style: |
  @import url("https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT@0,9..144,300..700,0..100;1,9..144,300..700,0..100&family=Instrument+Sans:wght@400;500;600&family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap");

  section {
    width: 720px;
    height: 1280px;
    font-family: "Instrument Sans", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #fffdf7;
    color: #2d2a26;
    padding: 96px 56px 64px;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    font-size: 30px;
    line-height: 1.45;
  }

  /* Vertically center big-number slides */
  section.market {
    justify-content: center;
  }

  h1, h2, h3 {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, "Times New Roman", serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #2d2a26;
    margin: 0 0 0.5em;
  }

  section > h1 {
    font-size: 72px;
    line-height: 1.05;
    margin: 0 0 40px;
  }

  blockquote {
    border-left: 4px solid #ede8e0;
    color: #2d2a26;
    font-size: 40px;
    line-height: 1.45;
    margin: 0 0 26px;
    padding: 0 0 0 32px;
    font-style: normal;
    quotes: none;
  }
  blockquote::before, blockquote::after { content: none; }
  blockquote p { margin: 0; }

  strong { color: #1a1a1a; font-weight: 700; }
  em { font-style: italic; color: #2d2a26; }

  section::after {
    font-family: "Instrument Sans", "Inter", sans-serif;
    font-size: 11px;
    color: #6f6a65;
    letter-spacing: 0.08em;
  }

  /* Cover slide — beginner (company) brand */
  section.cover { padding: 96px 56px; }
  section.cover .lockup {
    display: flex;
    align-items: center;
    gap: 24px;
    margin: 0 0 44px;
  }
  section.cover .lockup svg { width: 108px; height: 108px; }
  section.cover .lockup .wm {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, "Times New Roman", serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 800;
    font-size: 92px;
    letter-spacing: -0.04em;
    color: #2d5a3d;
    line-height: 1;
  }
  section.cover h1 { display: none; }
  section.cover .tagline {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, "Times New Roman", serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
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
    font-size: 22px;
    color: #6f6a65;
    letter-spacing: 0.02em;
    line-height: 1.7;
  }

  /* Tinker product slides — rainbow-web brand */
  section.tinker {
    padding-top: 116px;
    justify-content: flex-start;
  }
  section.tinker .tinker-badge {
    position: absolute;
    top: 40px;
    left: 56px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  section.tinker .tinker-badge svg { width: 48px; height: 48px; }
  section.tinker .tinker-badge .wm {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, "Times New Roman", serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 26px;
    letter-spacing: -0.01em;
    color: #2d2a26;
  }
  section.tinker .tinker-rainbow {
    position: absolute;
    top: 54px;
    right: 56px;
    width: 160px;
    height: 6px;
    background: linear-gradient(90deg, #f9a8d4 0%, #fdba74 18%, #fde68a 36%, #7bc47a 55%, #7dd3fc 75%, #c4b5fd 100%);
    border-radius: 999px;
  }
  section.tinker blockquote { border-left: 3px solid #c8b6e2; }
  section.tinker blockquote + blockquote { border-left-color: #7dd3fc; }

  /* Closing — centered "Thank you" bookended with beginner + tinker marks */
  section.closing { justify-content: center; align-items: center; padding-top: 80px; }
  section.closing > h1 {
    font-size: 96px;
    text-align: center;
    margin: 0;
    color: #2d5a3d;
    line-height: 1;
  }
  .beginner-badge {
    position: absolute;
    top: 40px;
    left: 56px;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .beginner-badge svg { width: 40px; height: 40px; }
  .beginner-badge .wm {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, "Times New Roman", serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 800;
    font-size: 28px;
    letter-spacing: -0.03em;
    color: #2d5a3d;
    line-height: 1;
  }
  section.closing .tinker-badge {
    position: absolute;
    top: 40px;
    right: 56px;
    left: auto;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  section.closing .tinker-badge svg { width: 40px; height: 40px; }
  section.closing .tinker-badge .wm {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, "Times New Roman", serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 28px;
    letter-spacing: -0.02em;
    color: #2d2a26;
    line-height: 1;
  }
  section.closing .closing-tagline {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, "Times New Roman", serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 32px;
    letter-spacing: -0.02em;
    color: #2d2a26;
    text-align: center;
    margin: 24px 0 0;
  }

  /* Product slide — inline SVG screenshot */
  .product-shot {
    display: block;
    width: 100%;
    max-width: 640px;
    height: auto;
    margin: 8px auto 0;
    filter: drop-shadow(0 16px 32px rgba(45, 42, 38, 0.18));
  }

  /* Mobile-view phone mockup */
  .mobile-mockup {
    display: block;
    width: 100%;
    max-width: 600px;
    height: auto;
    margin: 0 auto;
    filter: drop-shadow(0 16px 32px rgba(45, 42, 38, 0.18));
  }
  .solution-caption {
    text-align: center;
    font-size: 24px;
    font-style: italic;
    color: #6f6a65;
    margin: 20px auto 0;
    max-width: 620px;
    line-height: 1.35;
  }

  /* Solution slide — phone fills the slide */
  section.solution {
    padding: 56px 40px 40px;
    justify-content: center;
  }
  section.solution > h1 { display: none; }
  section.solution .mobile-mockup { max-width: 640px; }

  /* Traction timeline */
  .timeline {
    list-style: none;
    padding: 0;
    margin: 16px 0 0;
  }
  .timeline-item {
    display: flex;
    align-items: flex-start;
    gap: 24px;
    padding-bottom: 36px;
    position: relative;
  }
  .timeline-item:last-child { padding-bottom: 0; }
  .timeline-item:not(:last-child)::after {
    content: '';
    position: absolute;
    left: 11px;
    top: 32px;
    bottom: 0;
    width: 2px;
    background: #ede8e0;
  }
  .timeline-dot {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #2d5a3d;
    flex-shrink: 0;
    margin-top: 6px;
  }
  .timeline-dot.future {
    background: #fffdf7;
    border: 2px solid #c8b6e2;
    width: 20px;
    height: 20px;
    margin-top: 8px;
    margin-left: 2px;
  }
  .timeline-date {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 30px;
    color: #2d5a3d;
    line-height: 1.1;
    margin: 0 0 6px;
  }
  .timeline-date.future { color: #6f6a65; }
  .timeline-event {
    font-size: 26px;
    color: #2d2a26;
    line-height: 1.35;
    margin: 0;
  }
  .timeline-event.future { color: #6f6a65; }

  /* Ask slide — funding breakdown */
  section.ask blockquote {
    font-size: 32px;
    line-height: 1.4;
    margin: 0 0 28px;
  }
  section.ask p.min-line {
    font-size: 26px;
    line-height: 1.4;
    margin: 0 0 16px;
  }
  section.ask p.min-line strong {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, "Times New Roman", serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    color: #2d5a3d;
  }
  section.ask p.incr-lead {
    font-size: 22px;
    color: #6f6a65;
    margin: 20px 0 0;
  }

  /* Team slide — photo + one statement */
  section.team { justify-content: flex-start; }
  .team-photo {
    display: block;
    width: 280px;
    height: 280px;
    margin: 32px auto 28px;
    border-radius: 50%;
    overflow: hidden;
    background: #2d5a3d;
    box-shadow: 0 12px 32px rgba(45, 42, 38, 0.16);
  }
  .team-photo svg, .team-photo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .team-name {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 44px;
    color: #2d2a26;
    text-align: center;
    margin: 0 0 24px;
    letter-spacing: -0.02em;
  }
  .team-statement {
    font-size: 30px;
    color: #2d2a26;
    text-align: center;
    margin: 0 auto;
    max-width: 600px;
    line-height: 1.4;
  }

  /* Market slide — big TAM number */
  section.market .tam-headline {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, "Times New Roman", serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 88px;
    line-height: 1.1;
    letter-spacing: -0.02em;
    color: #2d5a3d;
    margin: 0 0 32px;
  }
  section.market .tam-math {
    font-size: 32px;
    line-height: 1.45;
    color: #2d2a26;
    margin: 0 0 22px;
  }
  section.market .tam-footnote {
    font-size: 24px;
    color: #6f6a65;
    line-height: 1.5;
    margin: 0;
  }

  /* Traction slide — one big number */
  section.traction .big-number {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, "Times New Roman", serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 144px;
    line-height: 1;
    letter-spacing: -0.04em;
    color: #2d5a3d;
    margin: 0;
  }
  section.traction .big-number-label {
    font-size: 36px;
    line-height: 1.4;
    color: #2d2a26;
    margin: 12px 0 0;
    max-width: 880px;
  }

---

<!-- Export to PDF: npx @marp-team/marp-cli@latest pitch-deck.md --theme-set pitch-portrait-theme.css --pdf --html --allow-local-files -->

<!-- _class: cover -->

<div class="lockup">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# beginner

<p class="tagline">Everyone is a founder</p>

<div class="meta">

Tyler Lindow · Founder of beginner<br>
Pre-seed · $500,000

</div>

---

<!-- _class: team -->

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# Team

<div class="team-photo">
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Tyler Lindow"><rect width="200" height="200" fill="#2d5a3d"/><text x="100" y="135" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-size="100" font-weight="700" fill="#fffdf7" font-variation-settings="'SOFT' 100, 'opsz' 144">TL</text></svg>
</div>

<p class="team-name">Tyler Lindow</p>

<p class="team-statement">Solo founder. 10 years bridging makers and money — half through software at scale, half through museums.</p>

---

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# Problem

> *Great builders spend whatever time they have left just trying to get a meal in. How can we expect them to be founders if they're still coding, not founding?*

---

<!-- _class: solution -->

# Solution

<svg class="mobile-mockup" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 540" role="img" aria-label="tinker mobile welcome screen"><rect x="4" y="4" width="312" height="532" rx="38" ry="38" fill="#fffdf7" stroke="#ede8e0" stroke-width="2"/><rect x="124" y="16" width="72" height="20" rx="10" fill="#1a1a1a" opacity="0.95"/><g transform="translate(24, 60)"><g transform="scale(0.13)"><rect width="200" height="200" rx="44" fill="#F5F3EF"/><circle cx="100" cy="100" r="76" fill="none" stroke="#C8B6E2" stroke-width="9"/><line x1="24.06" y1="62" x2="175.94" y2="62" stroke="#F9A8D4" stroke-width="9" stroke-linecap="round"/><line x1="24" y1="100" x2="176" y2="100" stroke="#FDBA74" stroke-width="9" stroke-linecap="round"/><line x1="24.06" y1="138" x2="175.94" y2="138" stroke="#FDE68A" stroke-width="9" stroke-linecap="round"/><ellipse cx="100" cy="100" rx="52" ry="76" fill="none" stroke="#7BC47A" stroke-width="9"/><ellipse cx="100" cy="100" rx="26" ry="76" fill="none" stroke="#7DD3FC" stroke-width="9"/><line x1="100" y1="24" x2="100" y2="176" stroke="#6EE7B7" stroke-width="9" stroke-linecap="round"/></g><text x="36" y="20" font-family="Fraunces, Plus Jakarta Sans, Georgia, serif" font-size="16" font-weight="700" fill="#2d2a26">tinker</text></g><g font-family="Inter, system-ui, sans-serif"><text x="24" y="116" font-size="10" letter-spacing="1.2" fill="#6f6a65">PITCH PROGRESS</text><text x="296" y="116" font-size="10" text-anchor="end" fill="#6f6a65" font-weight="700">0 / 11</text><rect x="24" y="122" width="272" height="3" rx="1.5" fill="#ede8e0"/></g><g text-anchor="middle"><g transform="translate(140, 168) scale(0.2)"><circle cx="100" cy="100" r="76" fill="none" stroke="#C8B6E2" stroke-width="9"/><line x1="24.06" y1="62" x2="175.94" y2="62" stroke="#F9A8D4" stroke-width="9" stroke-linecap="round"/><line x1="24" y1="100" x2="176" y2="100" stroke="#FDBA74" stroke-width="9" stroke-linecap="round"/><line x1="24.06" y1="138" x2="175.94" y2="138" stroke="#FDE68A" stroke-width="9" stroke-linecap="round"/><ellipse cx="100" cy="100" rx="52" ry="76" fill="none" stroke="#7BC47A" stroke-width="9"/><ellipse cx="100" cy="100" rx="26" ry="76" fill="none" stroke="#7DD3FC" stroke-width="9"/><line x1="100" y1="24" x2="100" y2="176" stroke="#6EE7B7" stroke-width="9" stroke-linecap="round"/></g><text x="160" y="234" font-family="Fraunces, Georgia, serif" font-size="20" font-weight="700" fill="#2d2a26">Everyone is a founder.</text><text x="160" y="256" font-family="Inter" font-size="12" fill="#6f6a65">You just need a seed to start.</text><text x="160" y="296" font-family="Inter" font-size="13" font-weight="600" fill="#2d2a26">Where are you right now?</text></g><g font-family="Inter, system-ui, sans-serif" font-size="14" font-weight="600" fill="#2d2a26" text-anchor="middle"><rect x="32" y="320" width="124" height="52" rx="13" fill="#fffdf7" stroke="#ede8e0" stroke-width="1"/><text x="94" y="351">Cafe</text><rect x="164" y="320" width="124" height="52" rx="13" fill="#fffdf7" stroke="#ede8e0" stroke-width="1"/><text x="226" y="351">Home</text><rect x="32" y="384" width="124" height="52" rx="13" fill="#fffdf7" stroke="#ede8e0" stroke-width="1"/><text x="94" y="415">Work</text><rect x="164" y="384" width="124" height="52" rx="13" fill="#fffdf7" stroke="#ede8e0" stroke-width="1"/><text x="226" y="415" font-size="12">Somewhere else</text></g><rect x="120" y="510" width="80" height="4" rx="2" fill="#1a1a1a" opacity="0.3"/></svg>

<p class="solution-caption">A guided interview that helps developers figure out their founder pitch. One-hundredth a coach.</p>

---

<!-- _class: traction -->

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# Traction

<ul class="timeline">
<li class="timeline-item">
<span class="timeline-dot"></span>
<div><p class="timeline-date">May 18, 2026</p><p class="timeline-event">App launched. tinker is live.</p></div>
</li>
<li class="timeline-item">
<span class="timeline-dot"></span>
<div><p class="timeline-date">Today, May 28, 2026</p><p class="timeline-event">First paid user — the founder.</p></div>
</li>
<li class="timeline-item">
<span class="timeline-dot future"></span>
<div><p class="timeline-date future">Month 6</p><p class="timeline-event future">Target: 1,000 paid developers.</p></div>
</li>
<li class="timeline-item">
<span class="timeline-dot future"></span>
<div><p class="timeline-date future">Month 12</p><p class="timeline-event future">Target: 2,000 paid developers (~$216,000 yearly revenue).</p></div>
</li>
</ul>

---

<!-- _class: market -->

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# Market

<p class="tam-headline">$2.16 billion a year</p>

<p class="tam-math"><strong>20 million developers × $9 a month.</strong></p>

<p class="tam-footnote">The market is every developer worldwide who could ship a founder pitch. At $9 a month, this is the ceiling — what we capture is what we earn.</p>

---

<!-- _class: ask -->

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# Ask

> *$500,000 → 12 months. Closing now — savings run out at the end of May.*

<p class="min-line"><strong>$168,000</strong> — founder salary, 12 months ($150,000 base + $18,000 benefits).</p>

<p class="min-line"><strong>$50,000</strong> — Instagram ads to non-developer makers (target: 2,000 paid users).</p>

<p class="min-line"><strong>$6,000</strong> — food at monthly community events ($500/month, 12 months).</p>

<p class="min-line"><strong>$35,000</strong> — legal, accounting, banking, incorporation.</p>

<p class="min-line"><strong>$25,000</strong> — Anthropic API (the per-user cost behind the $9 estimate).</p>

<p class="min-line"><strong>$20,000</strong> — San Francisco (3 months living + weekly flights home).</p>

<p class="min-line"><strong>$10,000</strong> — office and dev stack (Industrious $332/mo + Claude Code $200/mo + Vercel + PlanetScale + Stytch + GitHub).</p>

<p class="min-line"><strong>$186,000</strong> — reserves (extends runway to ~18 months at current burn).</p>

<p class="incr-lead">Line in the sand: savings run out end of May 2026. If the round doesn't close, I step away.</p>

---

<!-- _class: closing -->

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

<div class="tinker-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none" role="img" aria-label="tinker rainbow-web mark"><rect width="200" height="200" rx="44" fill="#F5F3EF"/><circle cx="100" cy="100" r="76" fill="none" stroke="#C8B6E2" stroke-width="9"/><line x1="24.06" y1="62.00" x2="175.94" y2="62.00" stroke="#F9A8D4" stroke-width="9" stroke-linecap="round"/><line x1="24.00" y1="100.00" x2="176.00" y2="100.00" stroke="#FDBA74" stroke-width="9" stroke-linecap="round"/><line x1="24.06" y1="138.00" x2="175.94" y2="138.00" stroke="#FDE68A" stroke-width="9" stroke-linecap="round"/><ellipse cx="100" cy="100" rx="52" ry="76" fill="none" stroke="#7BC47A" stroke-width="9"/><ellipse cx="100" cy="100" rx="26" ry="76" fill="none" stroke="#7DD3FC" stroke-width="9"/><line x1="100" y1="24" x2="100" y2="176" stroke="#6EE7B7" stroke-width="9" stroke-linecap="round"/></svg>
<span class="wm">tinker</span>
</div>

# Thank you

<p class="closing-tagline">Everyone is a founder</p>
