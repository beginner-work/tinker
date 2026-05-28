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

  /* Cover slide — landing-page hero pattern */
  section.cover {
    padding: 80px 48px 56px;
    text-align: center;
    align-items: center;
    justify-content: center;
  }
  section.cover .lockup {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    margin: 0 0 32px;
  }
  section.cover .lockup svg { width: 104px; height: 104px; }
  section.cover .lockup .wm {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, "Times New Roman", serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 800;
    font-size: 56px;
    letter-spacing: -0.03em;
    color: #2d5a3d;
    line-height: 1;
  }
  section.cover .kicker {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-style: italic;
    font-weight: 500;
    font-size: 22px;
    letter-spacing: 0.02em;
    color: #6f6a65;
    margin: 0 0 24px;
  }
  section.cover > h1 {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, "Times New Roman", serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 64px;
    line-height: 1.04;
    letter-spacing: -0.03em;
    color: #2d2a26;
    margin: 0 0 24px;
    max-width: 600px;
  }
  section.cover .lede {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 500;
    font-size: 24px;
    line-height: 1.45;
    color: #4a4742;
    max-width: 540px;
    margin: 0 auto 32px;
  }
  section.cover .hero-rainbow {
    width: 200px;
    height: 6px;
    border-radius: 999px;
    margin: 0 auto;
    background: linear-gradient(90deg, #f9a8d4 0%, #fdba74 18%, #fde68a 36%, #7bc47a 55%, #7dd3fc 75%, #c4b5fd 100%);
  }
  section.cover .meta {
    margin-top: auto;
    padding-top: 24px;
    border-top: 1px solid #ede8e0;
    font-size: 20px;
    color: #6f6a65;
    letter-spacing: 0.02em;
    line-height: 1.7;
    text-align: center;
    width: 100%;
    max-width: 480px;
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
    font-size: 22px;
    color: #2d2a26;
    margin: 20px auto 0;
    max-width: 620px;
    line-height: 1.45;
  }
  .solution-caption strong { font-weight: 700; color: #2d2a26; }

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
    gap: 20px;
    padding-bottom: 24px;
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

  /* Ask slide — visual breakdown */
  section.ask { justify-content: flex-start; }
  section.ask .ask-amount {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 96px;
    line-height: 1;
    letter-spacing: -0.04em;
    color: #2d5a3d;
    margin: 16px 0 12px;
  }
  section.ask .ask-period {
    font-family: "Fraunces", serif;
    font-style: italic;
    font-weight: 500;
    font-size: 24px;
    color: #6f6a65;
    margin: 0 0 32px;
  }
  section.ask .ask-bar {
    display: flex;
    width: 100%;
    height: 36px;
    border-radius: 8px;
    overflow: hidden;
    margin: 0 0 28px;
    box-shadow: 0 4px 12px rgba(45, 42, 38, 0.08);
  }
  section.ask .ask-bar-segment { height: 100%; }
  section.ask .ask-bar-segment.salary   { background: #2d5a3d; flex-basis: 33.6%; }
  section.ask .ask-bar-segment.gtm      { background: #7bc47a; flex-basis: 13.2%; }
  section.ask .ask-bar-segment.running  { background: #fdba74; flex-basis: 18%; }
  section.ask .ask-bar-segment.reserves { background: #c8b6e2; flex-basis: 35.2%; }
  section.ask .ask-legend {
    display: flex;
    flex-direction: column;
    gap: 18px;
    margin: 0 0 32px;
  }
  section.ask .ask-legend-item {
    display: flex;
    align-items: baseline;
    gap: 14px;
    font-size: 24px;
    line-height: 1.3;
  }
  section.ask .ask-legend-dot {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    flex-shrink: 0;
    transform: translateY(2px);
  }
  section.ask .ask-legend-dot.salary   { background: #2d5a3d; }
  section.ask .ask-legend-dot.gtm      { background: #7bc47a; }
  section.ask .ask-legend-dot.running  { background: #fdba74; }
  section.ask .ask-legend-dot.reserves { background: #c8b6e2; }
  section.ask .ask-legend-amount {
    font-family: "Fraunces", serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    color: #2d2a26;
  }
  section.ask .ask-legend-label { color: #2d2a26; }
  section.ask .ask-footer {
    font-size: 20px;
    color: #6f6a65;
    font-style: italic;
    line-height: 1.45;
    margin: 0;
  }

  /* Problem slide — two framings (go-to-market + vision) */
  section.problem .problem-block {
    margin-bottom: 36px;
  }
  section.problem .problem-block:last-child { margin-bottom: 0; }
  section.problem .problem-kicker {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-style: italic;
    font-size: 20px;
    color: #2d5a3d;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin: 0 0 14px;
  }
  section.problem blockquote {
    font-size: 28px;
    line-height: 1.4;
    margin: 0;
    padding: 0 0 0 24px;
    border-left: 3px solid #ede8e0;
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

<p class="kicker">a pitch deck · 2026</p>

# Everyone is a founder.

<p class="lede">beginner builds tinker — a guided conversation that helps builders discover their pitch over time.</p>

<div class="hero-rainbow"></div>

---

<!-- _class: team -->

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# Team

<div class="team-photo">
<img src="data:image/jpeg;base64,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" alt="Tyler Lindow" />
</div>

<p class="team-name">Tyler Lindow</p>

<p class="team-statement">10 years elevating engineers. From museums to IPO.</p>

---

<!-- _class: problem -->

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# Problem

<div class="problem-block">
<p class="problem-kicker">Go-to-market</p>
<blockquote><p><em>Great builders are not always great founders. Some go a whole career without building something of their own.</em></p></blockquote>
</div>

<div class="problem-block">
<p class="problem-kicker">Vision</p>
<blockquote><p><em>Our neighborhood culture holders are severely underfunded — barbers, Mexican folk healers. Humanity is dying.</em></p></blockquote>
</div>

---

<!-- _class: solution -->

# Solution

<svg class="mobile-mockup" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 540" role="img" aria-label="tinker mobile welcome screen"><rect x="4" y="4" width="312" height="532" rx="38" ry="38" fill="#fffdf7" stroke="#ede8e0" stroke-width="2"/><rect x="124" y="16" width="72" height="20" rx="10" fill="#1a1a1a" opacity="0.95"/><g transform="translate(24, 60)"><g transform="scale(0.13)"><rect width="200" height="200" rx="44" fill="#F5F3EF"/><circle cx="100" cy="100" r="76" fill="none" stroke="#C8B6E2" stroke-width="9"/><line x1="24.06" y1="62" x2="175.94" y2="62" stroke="#F9A8D4" stroke-width="9" stroke-linecap="round"/><line x1="24" y1="100" x2="176" y2="100" stroke="#FDBA74" stroke-width="9" stroke-linecap="round"/><line x1="24.06" y1="138" x2="175.94" y2="138" stroke="#FDE68A" stroke-width="9" stroke-linecap="round"/><ellipse cx="100" cy="100" rx="52" ry="76" fill="none" stroke="#7BC47A" stroke-width="9"/><ellipse cx="100" cy="100" rx="26" ry="76" fill="none" stroke="#7DD3FC" stroke-width="9"/><line x1="100" y1="24" x2="100" y2="176" stroke="#6EE7B7" stroke-width="9" stroke-linecap="round"/></g><text x="36" y="20" font-family="Fraunces, Plus Jakarta Sans, Georgia, serif" font-size="16" font-weight="700" fill="#2d2a26">tinker</text></g><g font-family="Inter, system-ui, sans-serif"><text x="24" y="116" font-size="10" letter-spacing="1.2" fill="#6f6a65">PITCH PROGRESS</text><text x="296" y="116" font-size="10" text-anchor="end" fill="#6f6a65" font-weight="700">0 / 11</text><rect x="24" y="122" width="272" height="3" rx="1.5" fill="#ede8e0"/></g><g text-anchor="middle"><g transform="translate(140, 168) scale(0.2)"><circle cx="100" cy="100" r="76" fill="none" stroke="#C8B6E2" stroke-width="9"/><line x1="24.06" y1="62" x2="175.94" y2="62" stroke="#F9A8D4" stroke-width="9" stroke-linecap="round"/><line x1="24" y1="100" x2="176" y2="100" stroke="#FDBA74" stroke-width="9" stroke-linecap="round"/><line x1="24.06" y1="138" x2="175.94" y2="138" stroke="#FDE68A" stroke-width="9" stroke-linecap="round"/><ellipse cx="100" cy="100" rx="52" ry="76" fill="none" stroke="#7BC47A" stroke-width="9"/><ellipse cx="100" cy="100" rx="26" ry="76" fill="none" stroke="#7DD3FC" stroke-width="9"/><line x1="100" y1="24" x2="100" y2="176" stroke="#6EE7B7" stroke-width="9" stroke-linecap="round"/></g><text x="160" y="234" font-family="Fraunces, Georgia, serif" font-size="20" font-weight="700" fill="#2d2a26">Everyone is a founder.</text><text x="160" y="256" font-family="Inter" font-size="12" fill="#6f6a65">You just need a seed to start.</text><text x="160" y="296" font-family="Inter" font-size="13" font-weight="600" fill="#2d2a26">Where are you right now?</text></g><g font-family="Inter, system-ui, sans-serif" font-size="14" font-weight="600" fill="#2d2a26" text-anchor="middle"><rect x="32" y="320" width="124" height="52" rx="13" fill="#fffdf7" stroke="#ede8e0" stroke-width="1"/><text x="94" y="351">Cafe</text><rect x="164" y="320" width="124" height="52" rx="13" fill="#fffdf7" stroke="#ede8e0" stroke-width="1"/><text x="226" y="351">Home</text><rect x="32" y="384" width="124" height="52" rx="13" fill="#fffdf7" stroke="#ede8e0" stroke-width="1"/><text x="94" y="415">Work</text><rect x="164" y="384" width="124" height="52" rx="13" fill="#fffdf7" stroke="#ede8e0" stroke-width="1"/><text x="226" y="415" font-size="12">Somewhere else</text></g><rect x="120" y="510" width="80" height="4" rx="2" fill="#1a1a1a" opacity="0.3"/></svg>

<p class="solution-caption"><strong>The GTM solution</strong>: An app that helps builders discover their pitch over time, on the go.</p>

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
<div><p class="timeline-date future">Q1 — August 2026</p><p class="timeline-event future">250 paid developers.</p></div>
</li>
<li class="timeline-item">
<span class="timeline-dot future"></span>
<div><p class="timeline-date future">Q2 — November 2026</p><p class="timeline-event future">1,000 paid developers.</p></div>
</li>
<li class="timeline-item">
<span class="timeline-dot future"></span>
<div><p class="timeline-date future">Christmas 2026</p><p class="timeline-event future">Maker discovery: 20 paid makers (Instagram + beginner market).</p></div>
</li>
<li class="timeline-item">
<span class="timeline-dot future"></span>
<div><p class="timeline-date future">Q3 — February 2027</p><p class="timeline-event future">2,000 paid developers.</p></div>
</li>
<li class="timeline-item">
<span class="timeline-dot future"></span>
<div><p class="timeline-date future">Q4 — May 2027</p><p class="timeline-event future">4,000 paid developers (~$432,000 yearly revenue).</p></div>
</li>
</ul>

---

<!-- _class: market -->

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# Market

<p class="tam-headline">$2.9 billion a year</p>

<p class="tam-math"><strong>27 million developers × $9 a month.</strong></p>

<p class="tam-footnote">Every developer on earth in 2026. For reference: LinkedIn Premium pulls in roughly $2 billion a year today.</p>

---

<!-- _class: ask -->

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# Ask

<p class="ask-amount">$500,000</p>

<p class="ask-period">12 months runway. Closing now.</p>

<div class="ask-bar">
<span class="ask-bar-segment salary"></span>
<span class="ask-bar-segment gtm"></span>
<span class="ask-bar-segment running"></span>
<span class="ask-bar-segment reserves"></span>
</div>

<div class="ask-legend">
<div class="ask-legend-item"><span class="ask-legend-dot salary"></span><span><span class="ask-legend-amount">$168K</span> &nbsp;<span class="ask-legend-label">salary</span></span></div>
<div class="ask-legend-item"><span class="ask-legend-dot gtm"></span><span><span class="ask-legend-amount">$66K</span> &nbsp;<span class="ask-legend-label">go-to-market + beginner market</span></span></div>
<div class="ask-legend-item"><span class="ask-legend-dot running"></span><span><span class="ask-legend-amount">$90K</span> &nbsp;<span class="ask-legend-label">running costs</span></span></div>
<div class="ask-legend-item"><span class="ask-legend-dot reserves"></span><span><span class="ask-legend-amount">$176K</span> &nbsp;<span class="ask-legend-label">reserves (~6 months extension)</span></span></div>
</div>

<p class="ask-footer">Savings run out end of May 2026. If the round doesn't close, I step away.</p>

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
