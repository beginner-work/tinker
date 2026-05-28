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

  /* Appendix slide — line item breakdown */
  section.appendix {
    padding: 96px 48px 48px;
  }
  section.appendix > h1 {
    font-size: 48px;
    margin: 0 0 8px;
  }
  section.appendix .appendix-sub {
    font-size: 16px;
    color: #6f6a65;
    margin: 0 0 24px;
    font-family: "Inter", sans-serif;
  }
  section.appendix .appendix-row {
    border-top: 1px solid #ede8e0;
    padding: 12px 0;
  }
  section.appendix .appendix-row:last-child {
    border-bottom: 1px solid #ede8e0;
  }
  section.appendix .appendix-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin: 0 0 4px;
  }
  section.appendix .appendix-label {
    font-family: "Fraunces", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 18px;
    color: #2d2a26;
  }
  section.appendix .appendix-amount {
    font-family: "Fraunces", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 18px;
    color: #2d5a3d;
  }
  section.appendix .appendix-detail {
    font-family: "Inter", sans-serif;
    font-size: 13px;
    line-height: 1.45;
    color: #6f6a65;
    margin: 0;
  }
  section.appendix .appendix-total {
    border-top: 2px solid #2d5a3d;
    padding-top: 14px;
    margin-top: 14px;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  section.appendix .appendix-total .label {
    font-family: "Fraunces", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 20px;
    color: #2d2a26;
  }
  section.appendix .appendix-total .value {
    font-family: "Fraunces", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 26px;
    color: #2d5a3d;
  }
  section.appendix .appendix-breakdown {
    margin-top: 20px;
    padding: 14px 16px;
    background: rgba(45, 90, 61, 0.06);
    border-left: 3px solid #2d5a3d;
    border-radius: 0 6px 6px 0;
  }
  section.appendix .appendix-breakdown-label {
    font-family: "Inter", sans-serif;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #2d5a3d;
    margin: 0 0 8px;
  }
  section.appendix .appendix-breakdown-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-family: "Inter", sans-serif;
    font-size: 13px;
    line-height: 1.4;
    padding: 5px 0;
    border-bottom: 1px dotted rgba(45, 90, 61, 0.18);
  }
  section.appendix .appendix-breakdown-row:last-child {
    border-bottom: none;
  }
  section.appendix .appendix-breakdown-name {
    color: #2d2a26;
  }
  section.appendix .appendix-breakdown-value {
    font-family: "Fraunces", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    color: #2d5a3d;
  }

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
  section.ask .ask-bar-segment.year1  { background: #2d5a3d; flex-basis: 61%; }
  section.ask .ask-bar-segment.year2  { background: #7bc47a; flex-basis: 35%; }
  section.ask .ask-bar-segment.beyond { background: #f9a8d4; flex-basis: 4%; }

  section.ask .ask-section {
    margin-top: 22px;
  }
  section.ask .ask-section:first-of-type { margin-top: 4px; }
  section.ask .ask-section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid #ede8e0;
    margin-bottom: 6px;
  }
  section.ask .ask-section-name {
    font-family: "Inter", sans-serif;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #6f6a65;
  }
  section.ask .ask-section-total {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 18px;
    color: #2d5a3d;
  }
  section.ask .ask-section .ask-legend-item {
    padding: 4px 0;
  }
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
  section.ask .ask-legend-dot.year1  { background: #2d5a3d; }
  section.ask .ask-legend-dot.year2  { background: #7bc47a; }
  section.ask .ask-legend-dot.beyond { background: #f9a8d4; }
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

  /* Transition slide — gentle pivot from problem to solution */
  section.transition {
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 96px 48px;
  }
  section.transition .transition-line {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-style: italic;
    font-weight: 500;
    font-size: 52px;
    line-height: 1.15;
    letter-spacing: -0.01em;
    color: #2d5a3d;
    margin: 0;
    max-width: 90%;
  }

  /* Problem slide — one page-filling statement */
  section.problem {
    justify-content: center;
  }
  section.problem > h1 {
    font-size: 36px;
    color: #6f6a65;
    margin: 0 0 32px;
    font-weight: 600;
  }
  section.problem .problem-statement {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 84px;
    line-height: 1.05;
    letter-spacing: -0.025em;
    color: #2d2a26;
    margin: 0;
    max-width: 100%;
  }
  section.problem .problem-statement em {
    color: #2d5a3d;
    font-style: italic;
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
  .team-photo img {
    color: transparent;
    font-size: 0;
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
  .team-name--lone {
    font-size: 56px;
    margin-top: 56px;
  }
  .team-learned-label {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-style: italic;
    font-weight: 600;
    font-size: 56px;
    line-height: 1.15;
    letter-spacing: -0.02em;
    color: #2d5a3d;
    text-align: center;
    margin: 72px auto 0;
    max-width: 600px;
  }
  .team-statement {
    font-size: 30px;
    color: #2d2a26;
    text-align: center;
    margin: 0 auto;
    max-width: 600px;
    line-height: 1.4;
  }

  /* Market slide — two markets, developers + makers */
  section.market .tam-headline {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, "Times New Roman", serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 80px;
    line-height: 1.05;
    letter-spacing: -0.02em;
    color: #2d5a3d;
    margin: 0 0 28px;
  }
  section.market .tam-math {
    font-size: 30px;
    line-height: 1.4;
    color: #2d2a26;
    margin: 0 0 22px;
  }
  section.market .market-split {
    display: flex;
    flex-direction: column;
    gap: 0;
    margin: 0 0 24px;
    border: 2px solid #2d5a3d;
    border-radius: 8px;
    overflow: hidden;
  }
  section.market .market-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 20px;
    background: #fbf8f0;
  }
  section.market .market-row + .market-row {
    border-top: 1px solid #ede8e0;
  }
  section.market .market-row .label {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 26px;
    color: #2d2a26;
  }
  section.market .market-row .value {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 28px;
    color: #2d5a3d;
  }
  section.market .market-row .sub {
    display: block;
    font-family: "Instrument Sans", "Inter", sans-serif;
    font-weight: 400;
    font-size: 16px;
    color: #6f6a65;
    margin-top: 4px;
  }
  section.market .tam-footnote {
    font-size: 22px;
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
  section.traction .evidence-note {
    margin-top: 28px;
    padding: 14px 18px;
    background: rgba(45, 90, 61, 0.06);
    border-left: 3px solid #2d5a3d;
    border-radius: 0 6px 6px 0;
    font-family: "Inter", sans-serif;
    font-size: 13px;
    line-height: 1.5;
    color: #2d2a26;
  }
  section.traction .evidence-note-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #2d5a3d;
    margin: 0 0 6px;
  }
  section.traction .evidence-note-text {
    margin: 0;
  }
  section.traction .evidence-note-text strong {
    font-family: "Fraunces", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    color: #2d5a3d;
  }

---

<!-- Export to PDF: npx @marp-team/marp-cli@latest pitch-deck.md --theme-set pitch-portrait-theme.css --pdf --html --allow-local-files -->

<!-- _class: cover -->

<div class="lockup">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# Everyone is a founder.

<div class="hero-rainbow"></div>

---

<!-- _class: team -->

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# Team

<div class="team-photo">
<img src="https://media.licdn.com/dms/image/v2/D5603AQHXoA9e1jmY-g/profile-displayphoto-scale_400_400/B56Zx8ISBgGwAg-/0/1771609072488?e=2147483647&amp;v=beta&amp;t=lpFI6tVSw90oPM76Ja65OQ1cUP5ZcsKtaxYTkaLJHNU" alt="Tyler Lindow" />
</div>

<p class="team-name">Tyler Lindow</p>

<p class="team-statement">10 years elevating engineers. From science museums to IPOs.</p>

<p class="team-learned-label">What have I learned?</p>

---

<!-- _class: problem -->

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# Problem

<p class="problem-statement">Engineers stay building while <em>human making becomes a relic of the past…</em></p>

---

<!-- _class: transition -->

<p class="transition-line">Here's what I built.</p>

---

<!-- _class: solution -->

# Solution

<svg class="mobile-mockup" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 540" role="img" aria-label="tinker mobile welcome screen"><rect x="4" y="4" width="312" height="532" rx="38" ry="38" fill="#fffdf7" stroke="#ede8e0" stroke-width="2"/><rect x="124" y="16" width="72" height="20" rx="10" fill="#1a1a1a" opacity="0.95"/><g transform="translate(24, 60)"><g transform="scale(0.13)"><rect width="200" height="200" rx="44" fill="#F5F3EF"/><circle cx="100" cy="100" r="76" fill="none" stroke="#C8B6E2" stroke-width="9"/><line x1="24.06" y1="62" x2="175.94" y2="62" stroke="#F9A8D4" stroke-width="9" stroke-linecap="round"/><line x1="24" y1="100" x2="176" y2="100" stroke="#FDBA74" stroke-width="9" stroke-linecap="round"/><line x1="24.06" y1="138" x2="175.94" y2="138" stroke="#FDE68A" stroke-width="9" stroke-linecap="round"/><ellipse cx="100" cy="100" rx="52" ry="76" fill="none" stroke="#7BC47A" stroke-width="9"/><ellipse cx="100" cy="100" rx="26" ry="76" fill="none" stroke="#7DD3FC" stroke-width="9"/><line x1="100" y1="24" x2="100" y2="176" stroke="#6EE7B7" stroke-width="9" stroke-linecap="round"/></g><text x="36" y="20" font-family="Fraunces, Plus Jakarta Sans, Georgia, serif" font-size="16" font-weight="700" fill="#2d2a26">tinker</text></g><g font-family="Inter, system-ui, sans-serif"><text x="24" y="116" font-size="10" letter-spacing="1.2" fill="#6f6a65">PITCH PROGRESS</text><text x="296" y="116" font-size="10" text-anchor="end" fill="#6f6a65" font-weight="700">0 / 11</text><rect x="24" y="122" width="272" height="3" rx="1.5" fill="#ede8e0"/></g><g text-anchor="middle"><g transform="translate(140, 168) scale(0.2)"><circle cx="100" cy="100" r="76" fill="none" stroke="#C8B6E2" stroke-width="9"/><line x1="24.06" y1="62" x2="175.94" y2="62" stroke="#F9A8D4" stroke-width="9" stroke-linecap="round"/><line x1="24" y1="100" x2="176" y2="100" stroke="#FDBA74" stroke-width="9" stroke-linecap="round"/><line x1="24.06" y1="138" x2="175.94" y2="138" stroke="#FDE68A" stroke-width="9" stroke-linecap="round"/><ellipse cx="100" cy="100" rx="52" ry="76" fill="none" stroke="#7BC47A" stroke-width="9"/><ellipse cx="100" cy="100" rx="26" ry="76" fill="none" stroke="#7DD3FC" stroke-width="9"/><line x1="100" y1="24" x2="100" y2="176" stroke="#6EE7B7" stroke-width="9" stroke-linecap="round"/></g><text x="160" y="234" font-family="Fraunces, Georgia, serif" font-size="20" font-weight="700" fill="#2d2a26">Everyone is a founder.</text><text x="160" y="256" font-family="Inter" font-size="12" fill="#6f6a65">You just need a seed to start.</text><text x="160" y="296" font-family="Inter" font-size="13" font-weight="600" fill="#2d2a26">Where are you right now?</text></g><g font-family="Inter, system-ui, sans-serif" font-size="14" font-weight="600" fill="#2d2a26" text-anchor="middle"><rect x="32" y="320" width="124" height="52" rx="13" fill="#fffdf7" stroke="#ede8e0" stroke-width="1"/><text x="94" y="351">Cafe</text><rect x="164" y="320" width="124" height="52" rx="13" fill="#fffdf7" stroke="#ede8e0" stroke-width="1"/><text x="226" y="351">Home</text><rect x="32" y="384" width="124" height="52" rx="13" fill="#fffdf7" stroke="#ede8e0" stroke-width="1"/><text x="94" y="415">Work</text><rect x="164" y="384" width="124" height="52" rx="13" fill="#fffdf7" stroke="#ede8e0" stroke-width="1"/><text x="226" y="415" font-size="12">Somewhere else</text></g><rect x="120" y="510" width="80" height="4" rx="2" fill="#1a1a1a" opacity="0.3"/></svg>

<p class="solution-caption"><strong>The GTM solution</strong>: An app that helps engineers discover their pitch over time, on the go.</p>

---

<!-- _class: transition -->

<p class="transition-line">Here's what I'd like to build.</p>

---

<!-- _class: solution -->

<svg class="mobile-mockup" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 540" role="img" aria-label="beginner marketplace mobile mockup"><rect x="4" y="4" width="312" height="532" rx="38" ry="38" fill="#fffdf7" stroke="#ede8e0" stroke-width="2"/><rect x="124" y="16" width="72" height="20" rx="10" fill="#1a1a1a" opacity="0.95"/><g transform="translate(20, 56)"><g transform="scale(0.11)"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></g><text x="28" y="16" font-family="Fraunces, Plus Jakarta Sans, Georgia, serif" font-size="15" font-weight="700" fill="#2d5a3d">beginner</text></g><g transform="translate(20, 88)"><rect width="280" height="34" rx="17" fill="#f5f3ef" stroke="#ede8e0" stroke-width="1"/><circle cx="18" cy="17" r="5" fill="none" stroke="#6f6a65" stroke-width="1.5"/><line x1="22" y1="21" x2="26" y2="25" stroke="#6f6a65" stroke-width="1.5" stroke-linecap="round"/><text x="36" y="21" font-family="Inter, sans-serif" font-size="11" fill="#6f6a65">Find a maker to seed</text></g><g transform="translate(20, 134)" font-family="Inter, sans-serif" font-size="10" font-weight="600"><rect x="0" y="0" width="42" height="22" rx="11" fill="#2d5a3d"/><text x="21" y="14" text-anchor="middle" fill="#fffdf7">All</text><rect x="48" y="0" width="58" height="22" rx="11" fill="#fffdf7" stroke="#ede8e0"/><text x="77" y="14" text-anchor="middle" fill="#2d2a26">Healers</text><rect x="112" y="0" width="38" height="22" rx="11" fill="#fffdf7" stroke="#ede8e0"/><text x="131" y="14" text-anchor="middle" fill="#2d2a26">Tea</text><rect x="156" y="0" width="62" height="22" rx="11" fill="#fffdf7" stroke="#ede8e0"/><text x="187" y="14" text-anchor="middle" fill="#2d2a26">Ceramics</text><rect x="224" y="0" width="48" height="22" rx="11" fill="#fffdf7" stroke="#ede8e0"/><text x="248" y="14" text-anchor="middle" fill="#2d2a26">Bread</text></g><g transform="translate(20, 168)" font-family="Fraunces, Georgia, serif" fill="#2d2a26"><rect x="0" y="0" width="130" height="106" rx="10" fill="#7bc47a"/><text x="65" y="62" text-anchor="middle" font-size="30" fill="#fffdf7" font-weight="700">.t</text><text x="0" y="124" font-size="12" font-weight="700">Tara H. · Herbal teas</text><text x="0" y="139" font-family="Inter, sans-serif" font-size="10" fill="#2d5a3d" font-weight="600">$420 seeded · 12 backers</text><rect x="142" y="0" width="130" height="106" rx="10" fill="#fdba74"/><text x="207" y="62" text-anchor="middle" font-size="30" fill="#fffdf7" font-weight="700">.j</text><text x="142" y="124" font-size="12" font-weight="700">Joe B. · Sourdough</text><text x="142" y="139" font-family="Inter, sans-serif" font-size="10" fill="#2d5a3d" font-weight="600">$180 seeded · 22 backers</text><rect x="0" y="154" width="130" height="106" rx="10" fill="#fde68a"/><text x="65" y="216" text-anchor="middle" font-size="30" fill="#fffdf7" font-weight="700">.m</text><text x="0" y="278" font-size="12" font-weight="700">Mia P. · Ceramics</text><text x="0" y="293" font-family="Inter, sans-serif" font-size="10" fill="#2d5a3d" font-weight="600">$640 seeded · 18 backers</text><rect x="142" y="154" width="130" height="106" rx="10" fill="#c8b6e2"/><text x="207" y="216" text-anchor="middle" font-size="30" fill="#fffdf7" font-weight="700">.c</text><text x="142" y="278" font-size="12" font-weight="700">Carlos M. · Healing</text><text x="142" y="293" font-family="Inter, sans-serif" font-size="10" fill="#2d5a3d" font-weight="600">$320 seeded · 9 backers</text></g><rect x="4" y="492" width="312" height="44" fill="#fffdf7"/><line x1="4" y1="492" x2="316" y2="492" stroke="#ede8e0" stroke-width="1"/><g font-family="Inter, sans-serif" font-size="8" font-weight="600"><text x="42" y="514" text-anchor="middle" fill="#2d5a3d">Explore</text><text x="100" y="514" text-anchor="middle" fill="#6f6a65">Saved</text><text x="160" y="514" text-anchor="middle" fill="#6f6a65">Pitches</text><text x="220" y="514" text-anchor="middle" fill="#6f6a65">Inbox</text><text x="278" y="514" text-anchor="middle" fill="#6f6a65">Profile</text></g></svg>

<p class="solution-caption"><strong>The Vision solution</strong>: A marketplace where you seed the makers behind the things you love.</p>

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
<div><p class="timeline-date">June 1, 2026</p><p class="timeline-event">First paying user — me.</p></div>
</li>
<li class="timeline-item">
<span class="timeline-dot future"></span>
<div><p class="timeline-date future">Dec 1, 2026</p><p class="timeline-event future">$100K ARR · 185 paying engineers.</p></div>
</li>
<li class="timeline-item">
<span class="timeline-dot future"></span>
<div><p class="timeline-date future">June 1, 2027</p><p class="timeline-event future">$400K ARR · 741 paying engineers · cash-flow positive (MRR exceeds monthly burn).</p></div>
</li>
<li class="timeline-item">
<span class="timeline-dot future"></span>
<div><p class="timeline-date future">Dec 1, 2027</p><p class="timeline-event future">$750K ARR · 1,400 paying engineers.</p></div>
</li>
</ul>

<div class="evidence-note">
<p class="evidence-note-label">Empirical basis</p>
<p class="evidence-note-text"><strong>10 people · 11 days · $9.03 in AI costs.</strong> 1 of them paid $9/month inside a week; that same person moved up to $45/month inside two weeks. The 18-month plan grows this same pattern 1,400 times — from ~1 new person a day today to ~45 a day by month 18. Limited by how many people I can reach alone, and the $181K AI budget across those 18 months.</p>
</div>

---

<!-- _class: market -->

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# GTM Market

<p class="tam-headline">$2.85 billion a year</p>

<p class="tam-math"><strong>22% of LinkedIn's 120 million paying subscribers × $9 a month.</strong></p>

<p class="tam-footnote">~26 million tech, engineering, and design professionals already paying for a professional tool. tinker is the next one.</p>

---

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

<!-- _class: market -->

# Vision Market

<p class="tam-headline">$71.3 billion a year</p>

<p class="tam-math"><strong>22% of Instagram's 3 billion users × $9 a month.</strong></p>

<p class="tam-footnote">22% of LinkedIn members are in tech, engineering, or design. Same ratio applied to Instagram.</p>

---

<!-- _class: ask -->

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# Ask

<p class="ask-amount">$500,000</p>

<p class="ask-period">18 months runway.</p>

<div class="ask-bar">
<span class="ask-bar-segment year1"></span>
<span class="ask-bar-segment year2"></span>
<span class="ask-bar-segment beyond"></span>
</div>

<div class="ask-section">
<div class="ask-section-head"><span class="ask-section-name">Year 1</span><span class="ask-section-total">$305K</span></div>
<div class="ask-legend-item"><span class="ask-legend-dot year1"></span><span><span class="ask-legend-amount">$175K</span> &nbsp;<span class="ask-legend-label">my salary</span></span></div>
<div class="ask-legend-item"><span class="ask-legend-dot year1"></span><span><span class="ask-legend-amount">$130K</span> &nbsp;<span class="ask-legend-label">running costs</span></span></div>
</div>

<div class="ask-section">
<div class="ask-section-head"><span class="ask-section-name">Year 2 (first 6 months)</span><span class="ask-section-total">$175K</span></div>
<div class="ask-legend-item"><span class="ask-legend-dot year2"></span><span><span class="ask-legend-amount">$95K</span> &nbsp;<span class="ask-legend-label">my salary (~6% inflation)</span></span></div>
<div class="ask-legend-item"><span class="ask-legend-dot year2"></span><span><span class="ask-legend-amount">$80K</span> &nbsp;<span class="ask-legend-label">running costs (lifetime-curve adj.)</span></span></div>
</div>

<div class="ask-section">
<div class="ask-section-head"><span class="ask-section-name">Beyond</span><span class="ask-section-total">$20K</span></div>
<div class="ask-legend-item"><span class="ask-legend-dot beyond"></span><span><span class="ask-legend-amount">$20K</span> &nbsp;<span class="ask-legend-label">maker discovery seed + cushion</span></span></div>
</div>

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

---

<!-- _class: appendix -->

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# Appendix

<p class="appendix-sub">Every line item in the $500,000 ask, fully itemized.</p>

<div class="appendix-row">
<div class="appendix-head"><span class="appendix-label">My salary, year 1</span><span class="appendix-amount">$175,000</span></div>
<p class="appendix-detail">12 months. Base + benefits, all in.</p>
</div>

<div class="appendix-row">
<div class="appendix-head"><span class="appendix-label">Running costs, year 1</span><span class="appendix-amount">$130,000</span></div>
<p class="appendix-detail">Anthropic API (the dominant line) + legal + accounting + banking + SF travel to build GTM motions (two one-week trips a year; extended stay only if accepted to an incubator) + Industrious office + Claude Code + Vercel + Neon + Stytch + GitHub.</p>
</div>

<div class="appendix-row">
<div class="appendix-head"><span class="appendix-label">My salary, year 2 (first 6 months)</span><span class="appendix-amount">$95,000</span></div>
<p class="appendix-detail">~6% inflation built into the year-2 rate. Keeps me in seat through the first half of year 2 without re-raising.</p>
</div>

<div class="appendix-row">
<div class="appendix-head"><span class="appendix-label">Running costs, year 2 (first 6 months)</span><span class="appendix-amount">$80,000</span></div>
<p class="appendix-detail">Anthropic API ~$70K (the Y1 cohort ages into low-cost maintenance use as new signups continue) + ~$10K for half a year of office, legal, stack, and one SF trip.</p>
</div>

<div class="appendix-row">
<div class="appendix-head"><span class="appendix-label">Maker discovery seed + cushion</span><span class="appendix-amount">$20,000</span></div>
<p class="appendix-detail">Everything left after the 18 months of runway costs. A small seed for maker channel research (one beginner market in the first year) plus a cushion for the unexpected. The engineer-only path is a viable venture business on its own; entering the maker market in scale is an investor decision once engineer GTM is proven.</p>
</div>

<div class="appendix-total"><span class="label">Total ask</span><span class="value">$500,000</span></div>

<div class="appendix-breakdown">
<p class="appendix-breakdown-label">Year 1 running costs — itemized</p>
<div class="appendix-breakdown-row"><span class="appendix-breakdown-name">Anthropic API</span><span class="appendix-breakdown-value">$111,000</span></div>
<div class="appendix-breakdown-row"><span class="appendix-breakdown-name">Legal + accounting + banking</span><span class="appendix-breakdown-value">$6,500</span></div>
<div class="appendix-breakdown-row"><span class="appendix-breakdown-name">SF travel — two one-week GTM trips</span><span class="appendix-breakdown-value">$5,000</span></div>
<div class="appendix-breakdown-row"><span class="appendix-breakdown-name">Industrious office ($332/mo × 12)</span><span class="appendix-breakdown-value">$4,000</span></div>
<div class="appendix-breakdown-row"><span class="appendix-breakdown-name">Claude Code Max ($200/mo × 12)</span><span class="appendix-breakdown-value">$2,500</span></div>
<div class="appendix-breakdown-row"><span class="appendix-breakdown-name">Stack — Vercel + Neon + Stytch + GitHub + domain</span><span class="appendix-breakdown-value">$1,000</span></div>
<div class="appendix-breakdown-row"><span class="appendix-breakdown-name">Year 1 running costs total</span><span class="appendix-breakdown-value">$130,000</span></div>
</div>
