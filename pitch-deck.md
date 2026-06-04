---
marp: true
theme: portrait
title: "Everyone is a founder."
description: "Everyone is a founder."
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

  /* GTM solution — two high-fidelity device renders reproduced from the live
     home screens: the tinker writing flow ("What are you learning?") and the
     beginner "Back me" profile QR. Markup and styling mirror
     src/renderer (writing) and beginner ui/public/tyler-lindow (Back me) so
     the slide shows the actual product, not an illustration of it. */
  .gtm-duo {
    display: flex;
    gap: 26px;
    justify-content: center;
    align-items: stretch;
    margin: 0 auto;
  }
  .gtm-duo .device {
    width: 296px;
    flex: 0 0 296px;
    background: #111110;
    border-radius: 46px;
    padding: 10px;
    box-shadow: 0 22px 48px rgba(45, 42, 38, 0.26);
  }
  .gtm-duo .device__screen {
    position: relative;
    box-sizing: border-box;
    height: 600px;
    border-radius: 38px;
    overflow: hidden;
    background: #fffdf7;
    display: flex;
    flex-direction: column;
    font-family: "Instrument Sans", "Inter", system-ui, sans-serif;
  }
  .gtm-duo .device__screen * { box-sizing: border-box; }
  .gtm-duo .device__pill {
    position: absolute;
    top: 11px;
    left: 50%;
    transform: translateX(-50%);
    width: 92px;
    height: 20px;
    border-radius: 11px;
    background: #111110;
    z-index: 6;
  }
  .gtm-duo .device__label {
    text-align: center;
    font-size: 15px;
    font-weight: 600;
    color: #6f6a65;
    margin: 14px 0 0;
    font-family: "Inter", sans-serif;
  }

  /* ── Screen 1 · the writing flow ─────────────────────────────────── */
  .scr-write {
    background:
      radial-gradient(circle at 18% 8%, rgba(123, 196, 122, 0.10), transparent 40%),
      radial-gradient(circle at 88% 4%, rgba(165, 180, 252, 0.13), transparent 40%),
      #fffdf7;
  }
  .scr-write__top {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 42px 18px 13px;
    border-bottom: 1px solid rgba(237, 232, 224, 0.6);
  }
  .scr-write__close {
    width: 26px;
    height: 26px;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #2d2a26;
    font-size: 18px;
    line-height: 1;
  }
  .scr-write__dots {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .scr-write__dots i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #ede8e0;
  }
  .scr-write__dots i.is-active {
    background: #6366f1;
    transform: scale(1.4);
  }
  .scr-write__step {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #6f6a65;
    flex: none;
  }
  .scr-write__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 26px 18px 18px;
  }
  .scr-write__q {
    margin: 0;
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-size: 25px;
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.2;
    color: #2d2a26;
  }
  .scr-write__input {
    flex: 1;
    padding: 15px 16px;
    background: #ffffff;
    border: 1px solid #6366f1;
    border-radius: 16px;
    box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.15);
    font-size: 14px;
    line-height: 1.6;
    color: #2d2a26;
  }
  .scr-write__input .caret {
    display: inline-block;
    width: 2px;
    height: 1.05em;
    background: #6366f1;
    vertical-align: -2px;
    margin-left: 1px;
  }
  .scr-write__foot {
    display: flex;
    justify-content: flex-end;
    gap: 9px;
    padding: 13px 18px 18px;
    border-top: 1px solid rgba(237, 232, 224, 0.6);
  }
  .scr-write__end,
  .scr-write__next {
    height: 38px;
    display: inline-flex;
    align-items: center;
    padding: 0 16px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 12.5px;
  }
  .scr-write__end {
    background: #ffffff;
    color: #2d2a26;
    border: 1px solid #ede8e0;
  }
  .scr-write__next {
    background: #6366f1;
    color: #ffffff;
    box-shadow: 0 1px 2px rgba(99, 102, 241, 0.18), 0 6px 18px rgba(99, 102, 241, 0.22);
  }

  /* ── Screen 2 · the Back me QR page ──────────────────────────────── */
  .scr-qr {
    background: #f5f3ef;
    padding: 42px 22px 22px;
    display: block;
  }
  .scr-qr__brand {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    margin: 0 0 22px;
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 17px;
    color: #1f1d1a;
  }
  .scr-qr__tabs {
    display: flex;
    gap: 24px;
    margin: 0 0 24px;
    border-bottom: 1px solid #e8e3d8;
  }
  .scr-qr__tab {
    font-weight: 600;
    font-size: 14px;
    letter-spacing: -0.01em;
    color: #6f6a62;
    padding: 8px 2px;
    position: relative;
  }
  .scr-qr__tab.is-active {
    color: #1f1d1a;
  }
  .scr-qr__tab.is-active::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    background: #1f1d1a;
    border-radius: 2px;
  }
  .scr-qr__card {
    text-align: center;
    max-width: 234px;
    margin: 6px auto 0;
    padding: 24px 20px 22px;
    background: #fffdf7;
    border: 1px solid #e8e3d8;
    border-radius: 22px;
    box-shadow: 0 12px 34px rgba(45, 42, 38, 0.10);
  }
  .scr-qr__photo {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    margin: 0 auto 12px;
    overflow: hidden;
    border: 3px solid #fffdf7;
    box-shadow: 0 4px 14px rgba(45, 42, 38, 0.16);
    display: block;
  }
  .scr-qr__photo svg { display: block; }
  .scr-qr__name {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 18px;
    letter-spacing: -0.01em;
    margin: 0 0 3px;
    color: #1f1d1a;
  }
  .scr-qr__role {
    margin: 0 0 16px;
    font-size: 12px;
    color: #6f6a62;
  }
  .scr-qr__qr {
    width: 168px;
    height: 168px;
    margin: 0 auto 14px;
  }
  .scr-qr__qr svg {
    width: 100%;
    height: 100%;
    display: block;
    border-radius: 6px;
  }
  .scr-qr__scan {
    margin: 0;
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-size: 13px;
    color: #1f1d1a;
  }

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
  section.ask .ask-bar-segment.year1  { background: #2d5a3d; flex-basis: 62%; }
  section.ask .ask-bar-segment.year2  { background: #7bc47a; flex-basis: 37%; }
  section.ask .ask-bar-segment.beyond { background: #f9a8d4; flex-basis: 1%; }

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
  section.ask .ask-callout {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin: 10px 0 0 30px;
    padding: 12px 16px;
    background: rgba(45, 90, 61, 0.07);
    border-left: 4px solid #2d5a3d;
    border-radius: 8px;
    font-size: 20px;
    line-height: 1.4;
    color: #2d2a26;
  }
  section.ask .ask-callout-amount {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 24px;
    color: #2d5a3d;
    flex-shrink: 0;
  }
  section.ask .ask-callout strong { color: #2d5a3d; font-weight: 700; }
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
  section.team > h1 { margin-bottom: 14px; }
  .team-subtitle {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-style: italic;
    font-size: 32px;
    line-height: 1.3;
    letter-spacing: -0.01em;
    color: #6f6a65;
    margin: 0 0 8px;
    max-width: 600px;
  }

  /* Location slide — answers the title slide's "Where am I?" */
  section.location {
    justify-content: center;
    align-items: center;
    text-align: center;
  }
  section.location .location-label {
    font-family: "Inter", sans-serif;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #6f6a65;
    margin: 0 0 20px;
  }
  section.location .location-value {
    display: inline-flex;
    align-items: center;
    gap: 18px;
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 72px;
    line-height: 1.05;
    letter-spacing: -0.02em;
    color: #2d2a26;
  }
  section.location .location-value svg { width: 56px; height: 56px; flex: none; }
  section.location .location-statement {
    font-family: "Fraunces", "Plus Jakarta Sans", Georgia, serif;
    font-variation-settings: "SOFT" 100, "WONK" 0, "opsz" 144;
    font-weight: 700;
    font-size: 56px;
    line-height: 1.15;
    letter-spacing: -0.02em;
    color: #2d2a26;
    max-width: 580px;
    margin: 0 auto;
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

<!-- _class: team -->

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# I am beginner

<p class="team-subtitle">A solo-employee company, building towards venture scale.</p>

<div class="team-photo">
<img src="https://media.licdn.com/dms/image/v2/D5603AQHXoA9e1jmY-g/profile-displayphoto-scale_400_400/B56Zx8ISBgGwAg-/0/1771609072488?e=2147483647&amp;v=beta&amp;t=lpFI6tVSw90oPM76Ja65OQ1cUP5ZcsKtaxYTkaLJHNU" alt="Tyler Lindow" />
</div>

<p class="team-name">Tyler Lindow</p>

<p class="team-statement">10 years elevating engineers. From science museums to IPOs.</p>

<p class="team-learned-label">Where am I?</p>

---

<!-- _class: location -->

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

<p class="location-label">Why now</p>

<p class="location-statement">Because I don&rsquo;t feel good eating McDonald&rsquo;s.</p>

---

<!-- _class: ask -->

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# My Ask
<p class="ask-amount">$500,000</p>

<p class="ask-period">18 months runway.</p>

<div class="ask-bar">
<span class="ask-bar-segment year1"></span>
<span class="ask-bar-segment year2"></span>
<span class="ask-bar-segment beyond"></span>
</div>

<div class="ask-section">
<div class="ask-section-head"><span class="ask-section-name">Year 1</span><span class="ask-section-total">$312K</span></div>
<div class="ask-legend-item"><span class="ask-legend-dot year1"></span><span><span class="ask-legend-amount">$175K</span> &nbsp;<span class="ask-legend-label">my salary</span></span></div>
<div class="ask-legend-item"><span class="ask-legend-dot year1"></span><span><span class="ask-legend-amount">$137K</span> &nbsp;<span class="ask-legend-label">running costs</span></span></div>
<div class="ask-callout"><span class="ask-callout-amount">$111K</span><span>of that is the <strong>Anthropic API</strong> &mdash; our single largest cost in year one.</span></div>
</div>

<div class="ask-section">
<div class="ask-section-head"><span class="ask-section-name">Year 2 (first 6 months)</span><span class="ask-section-total">$185K</span></div>
<div class="ask-legend-item"><span class="ask-legend-dot year2"></span><span><span class="ask-legend-amount">$95K</span> &nbsp;<span class="ask-legend-label">my salary (~6% inflation)</span></span></div>
<div class="ask-legend-item"><span class="ask-legend-dot year2"></span><span><span class="ask-legend-amount">$90K</span> &nbsp;<span class="ask-legend-label">running costs</span></span></div>
</div>

<div class="ask-section">
<div class="ask-section-head"><span class="ask-section-name">Beyond</span><span class="ask-section-total">$3K</span></div>
<div class="ask-legend-item"><span class="ask-legend-dot beyond"></span><span><span class="ask-legend-amount">$3K</span> &nbsp;<span class="ask-legend-label">cushion for the unexpected</span></span></div>
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
<div><p class="timeline-date">June 1, 2026</p><p class="timeline-event">First seed tier user — me.</p></div>
</li>
<li class="timeline-item">
<span class="timeline-dot future"></span>
<div><p class="timeline-date future">Dec 1, 2026</p><p class="timeline-event future">$100K/year in subscriptions · 185 paying engineers.</p></div>
</li>
<li class="timeline-item">
<span class="timeline-dot future"></span>
<div><p class="timeline-date future">June 1, 2027</p><p class="timeline-event future">$400K/year in subscriptions · 741 paying engineers · monthly revenue covers monthly costs.</p></div>
</li>
<li class="timeline-item">
<span class="timeline-dot future"></span>
<div><p class="timeline-date future">Dec 1, 2027</p><p class="timeline-event future">$750K/year in subscriptions · 1,400 paying engineers.</p></div>
</li>
</ul>

<div class="evidence-note">
<p class="evidence-note-label">Empirical basis</p>
<p class="evidence-note-text"><strong>10 people — including me · 11 days · $9.03 in AI costs.</strong> I paid $9/month inside a week, then moved up to $45/month inside two weeks. The 18-month plan grows this same pattern 1,400 times — from ~1 new person a day today to ~45 a day by month 18. Limited by how many people I can reach alone, and the $181K AI budget across those 18 months.</p>
</div>

---

<!-- _class: solution -->

<svg class="mobile-mockup" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 540" role="img" aria-label="beginner marketplace mobile mockup"><rect x="4" y="4" width="312" height="532" rx="38" ry="38" fill="#fffdf7" stroke="#ede8e0" stroke-width="2"/><rect x="124" y="16" width="72" height="20" rx="10" fill="#1a1a1a" opacity="0.95"/><g transform="translate(20, 56)"><g transform="scale(0.11)"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></g><text x="28" y="16" font-family="Fraunces, Plus Jakarta Sans, Georgia, serif" font-size="15" font-weight="700" fill="#2d5a3d">beginner</text></g><g transform="translate(20, 88)"><rect width="280" height="34" rx="17" fill="#f5f3ef" stroke="#ede8e0" stroke-width="1"/><circle cx="18" cy="17" r="5" fill="none" stroke="#6f6a65" stroke-width="1.5"/><line x1="22" y1="21" x2="26" y2="25" stroke="#6f6a65" stroke-width="1.5" stroke-linecap="round"/><text x="36" y="21" font-family="Inter, sans-serif" font-size="11" fill="#6f6a65">Find a maker to seed</text></g><g transform="translate(20, 134)" font-family="Inter, sans-serif" font-size="10" font-weight="600"><rect x="0" y="0" width="42" height="22" rx="11" fill="#2d5a3d"/><text x="21" y="14" text-anchor="middle" fill="#fffdf7">All</text><rect x="48" y="0" width="58" height="22" rx="11" fill="#fffdf7" stroke="#ede8e0"/><text x="77" y="14" text-anchor="middle" fill="#2d2a26">Healers</text><rect x="112" y="0" width="38" height="22" rx="11" fill="#fffdf7" stroke="#ede8e0"/><text x="131" y="14" text-anchor="middle" fill="#2d2a26">Tea</text><rect x="156" y="0" width="62" height="22" rx="11" fill="#fffdf7" stroke="#ede8e0"/><text x="187" y="14" text-anchor="middle" fill="#2d2a26">Ceramics</text><rect x="224" y="0" width="48" height="22" rx="11" fill="#fffdf7" stroke="#ede8e0"/><text x="248" y="14" text-anchor="middle" fill="#2d2a26">Bread</text></g><g transform="translate(20, 168)" font-family="Fraunces, Georgia, serif" fill="#2d2a26"><rect x="0" y="0" width="130" height="106" rx="10" fill="#7bc47a"/><text x="65" y="62" text-anchor="middle" font-size="30" fill="#fffdf7" font-weight="700">.t</text><text x="0" y="124" font-size="12" font-weight="700">Tara H. · Herbal teas</text><text x="0" y="139" font-family="Inter, sans-serif" font-size="10" fill="#2d5a3d" font-weight="600">$420 seeded · 12 backers</text><rect x="142" y="0" width="130" height="106" rx="10" fill="#fdba74"/><text x="207" y="62" text-anchor="middle" font-size="30" fill="#fffdf7" font-weight="700">.j</text><text x="142" y="124" font-size="12" font-weight="700">Joe B. · Sourdough</text><text x="142" y="139" font-family="Inter, sans-serif" font-size="10" fill="#2d5a3d" font-weight="600">$180 seeded · 22 backers</text><rect x="0" y="154" width="130" height="106" rx="10" fill="#fde68a"/><text x="65" y="216" text-anchor="middle" font-size="30" fill="#fffdf7" font-weight="700">.m</text><text x="0" y="278" font-size="12" font-weight="700">Mia P. · Ceramics</text><text x="0" y="293" font-family="Inter, sans-serif" font-size="10" fill="#2d5a3d" font-weight="600">$640 seeded · 18 backers</text><rect x="142" y="154" width="130" height="106" rx="10" fill="#c8b6e2"/><text x="207" y="216" text-anchor="middle" font-size="30" fill="#fffdf7" font-weight="700">.c</text><text x="142" y="278" font-size="12" font-weight="700">Carlos M. · Healing</text><text x="142" y="293" font-family="Inter, sans-serif" font-size="10" fill="#2d5a3d" font-weight="600">$320 seeded · 9 backers</text></g><rect x="4" y="492" width="312" height="44" fill="#fffdf7"/><line x1="4" y1="492" x2="316" y2="492" stroke="#ede8e0" stroke-width="1"/><g font-family="Inter, sans-serif" font-size="8" font-weight="600"><text x="42" y="514" text-anchor="middle" fill="#2d5a3d">Explore</text><text x="100" y="514" text-anchor="middle" fill="#6f6a65">Saved</text><text x="160" y="514" text-anchor="middle" fill="#6f6a65">Pitches</text><text x="220" y="514" text-anchor="middle" fill="#6f6a65">Inbox</text><text x="278" y="514" text-anchor="middle" fill="#6f6a65">Profile</text></g></svg>

<p class="solution-caption"><strong>The Vision solution</strong>: A marketplace where you seed the makers behind the things you love.</p>

---

<!-- _class: transition -->

<p class="transition-line">Here's what I'd like to build.</p>

---

<!-- _class: solution -->

# Solution

<div class="gtm-duo">

<div>
<div class="device" role="img" aria-label="tinker — the writing flow asking What are you learning?">
<div class="device__pill"></div>
<div class="device__screen scr-write">
<div class="scr-write__top"><span class="scr-write__close">&#10005;</span><span class="scr-write__dots"><i class="is-active"></i><i></i><i></i><i></i><i></i></span><span class="scr-write__step">Question 1</span></div>
<div class="scr-write__body"><h3 class="scr-write__q">What are you learning?</h3><div class="scr-write__input">Three caf&eacute;s said yes this week. What I&rsquo;m noticing: the hard part was never the pitch &mdash; it was letting myself believe I&rsquo;m already allowed to make one.<span class="caret"></span></div></div>
<div class="scr-write__foot"><span class="scr-write__end">This is everything &rarr;</span><span class="scr-write__next">Next &rarr;</span></div>
</div>
</div>
<p class="device__label">Discover your pitch, over time</p>
</div>

<div>
<div class="device" role="img" aria-label="beginner — your Back me page with a profile QR code">
<div class="device__pill"></div>
<div class="device__screen scr-qr">
<span class="scr-qr__brand"><svg viewBox="0 0 180 180" width="24" height="24" aria-hidden="true" fill="none"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>beginner</span>
<div class="scr-qr__tabs"><span class="scr-qr__tab">Profile</span><span class="scr-qr__tab is-active">Back me</span></div>
<div class="scr-qr__card"><span class="scr-qr__photo"><svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true"><rect width="64" height="64" fill="#2d5a3d"/><circle cx="32" cy="26" r="12" fill="#f5f3ef" opacity="0.95"/><path d="M11 60 c0 -12 9 -21 21 -21 c12 0 21 9 21 21 z" fill="#f5f3ef" opacity="0.95"/></svg></span><p class="scr-qr__name">Tyler Lindow</p><p class="scr-qr__role">Founder of beginner</p><div class="scr-qr__qr"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 37 37" role="img" aria-label="QR code linking to https://www.beginner.work/tyler-lindow#share" shape-rendering="crispEdges"><rect width="37" height="37" fill="#fffdf7"/><path d="M2,2h1v1h-1zM3,2h1v1h-1zM4,2h1v1h-1zM5,2h1v1h-1zM6,2h1v1h-1zM7,2h1v1h-1zM8,2h1v1h-1zM11,2h1v1h-1zM13,2h1v1h-1zM14,2h1v1h-1zM15,2h1v1h-1zM18,2h1v1h-1zM19,2h1v1h-1zM21,2h1v1h-1zM22,2h1v1h-1zM25,2h1v1h-1zM28,2h1v1h-1zM29,2h1v1h-1zM30,2h1v1h-1zM31,2h1v1h-1zM32,2h1v1h-1zM33,2h1v1h-1zM34,2h1v1h-1zM2,3h1v1h-1zM8,3h1v1h-1zM11,3h1v1h-1zM12,3h1v1h-1zM13,3h1v1h-1zM14,3h1v1h-1zM15,3h1v1h-1zM16,3h1v1h-1zM17,3h1v1h-1zM19,3h1v1h-1zM24,3h1v1h-1zM26,3h1v1h-1zM28,3h1v1h-1zM34,3h1v1h-1zM2,4h1v1h-1zM4,4h1v1h-1zM5,4h1v1h-1zM6,4h1v1h-1zM8,4h1v1h-1zM10,4h1v1h-1zM14,4h1v1h-1zM15,4h1v1h-1zM17,4h1v1h-1zM18,4h1v1h-1zM19,4h1v1h-1zM20,4h1v1h-1zM21,4h1v1h-1zM22,4h1v1h-1zM25,4h1v1h-1zM26,4h1v1h-1zM28,4h1v1h-1zM30,4h1v1h-1zM31,4h1v1h-1zM32,4h1v1h-1zM34,4h1v1h-1zM2,5h1v1h-1zM4,5h1v1h-1zM5,5h1v1h-1zM6,5h1v1h-1zM8,5h1v1h-1zM10,5h1v1h-1zM12,5h1v1h-1zM14,5h1v1h-1zM16,5h1v1h-1zM18,5h1v1h-1zM21,5h1v1h-1zM22,5h1v1h-1zM23,5h1v1h-1zM24,5h1v1h-1zM26,5h1v1h-1zM28,5h1v1h-1zM30,5h1v1h-1zM31,5h1v1h-1zM32,5h1v1h-1zM34,5h1v1h-1zM2,6h1v1h-1zM4,6h1v1h-1zM5,6h1v1h-1zM6,6h1v1h-1zM8,6h1v1h-1zM10,6h1v1h-1zM11,6h1v1h-1zM13,6h1v1h-1zM14,6h1v1h-1zM17,6h1v1h-1zM20,6h1v1h-1zM23,6h1v1h-1zM26,6h1v1h-1zM28,6h1v1h-1zM30,6h1v1h-1zM31,6h1v1h-1zM32,6h1v1h-1zM34,6h1v1h-1zM2,7h1v1h-1zM8,7h1v1h-1zM10,7h1v1h-1zM13,7h1v1h-1zM14,7h1v1h-1zM16,7h1v1h-1zM17,7h1v1h-1zM18,7h1v1h-1zM19,7h1v1h-1zM22,7h1v1h-1zM23,7h1v1h-1zM24,7h1v1h-1zM28,7h1v1h-1zM34,7h1v1h-1zM2,8h1v1h-1zM3,8h1v1h-1zM4,8h1v1h-1zM5,8h1v1h-1zM6,8h1v1h-1zM7,8h1v1h-1zM8,8h1v1h-1zM10,8h1v1h-1zM12,8h1v1h-1zM14,8h1v1h-1zM16,8h1v1h-1zM18,8h1v1h-1zM20,8h1v1h-1zM22,8h1v1h-1zM24,8h1v1h-1zM26,8h1v1h-1zM28,8h1v1h-1zM29,8h1v1h-1zM30,8h1v1h-1zM31,8h1v1h-1zM32,8h1v1h-1zM33,8h1v1h-1zM34,8h1v1h-1zM10,9h1v1h-1zM14,9h1v1h-1zM16,9h1v1h-1zM17,9h1v1h-1zM23,9h1v1h-1zM24,9h1v1h-1zM2,10h1v1h-1zM4,10h1v1h-1zM5,10h1v1h-1zM6,10h1v1h-1zM7,10h1v1h-1zM8,10h1v1h-1zM11,10h1v1h-1zM12,10h1v1h-1zM15,10h1v1h-1zM16,10h1v1h-1zM17,10h1v1h-1zM19,10h1v1h-1zM24,10h1v1h-1zM26,10h1v1h-1zM28,10h1v1h-1zM29,10h1v1h-1zM30,10h1v1h-1zM31,10h1v1h-1zM32,10h1v1h-1zM2,11h1v1h-1zM7,11h1v1h-1zM9,11h1v1h-1zM10,11h1v1h-1zM11,11h1v1h-1zM13,11h1v1h-1zM14,11h1v1h-1zM16,11h1v1h-1zM18,11h1v1h-1zM20,11h1v1h-1zM21,11h1v1h-1zM23,11h1v1h-1zM25,11h1v1h-1zM28,11h1v1h-1zM29,11h1v1h-1zM31,11h1v1h-1zM32,11h1v1h-1zM34,11h1v1h-1zM2,12h1v1h-1zM4,12h1v1h-1zM5,12h1v1h-1zM6,12h1v1h-1zM8,12h1v1h-1zM10,12h1v1h-1zM13,12h1v1h-1zM14,12h1v1h-1zM17,12h1v1h-1zM18,12h1v1h-1zM20,12h1v1h-1zM23,12h1v1h-1zM26,12h1v1h-1zM30,12h1v1h-1zM32,12h1v1h-1zM33,12h1v1h-1zM2,13h1v1h-1zM3,13h1v1h-1zM6,13h1v1h-1zM7,13h1v1h-1zM9,13h1v1h-1zM10,13h1v1h-1zM11,13h1v1h-1zM13,13h1v1h-1zM16,13h1v1h-1zM17,13h1v1h-1zM21,13h1v1h-1zM23,13h1v1h-1zM24,13h1v1h-1zM25,13h1v1h-1zM27,13h1v1h-1zM28,13h1v1h-1zM30,13h1v1h-1zM31,13h1v1h-1zM32,13h1v1h-1zM2,14h1v1h-1zM3,14h1v1h-1zM4,14h1v1h-1zM6,14h1v1h-1zM7,14h1v1h-1zM8,14h1v1h-1zM13,14h1v1h-1zM14,14h1v1h-1zM20,14h1v1h-1zM23,14h1v1h-1zM25,14h1v1h-1zM26,14h1v1h-1zM27,14h1v1h-1zM29,14h1v1h-1zM30,14h1v1h-1zM31,14h1v1h-1zM33,14h1v1h-1zM34,14h1v1h-1zM2,15h1v1h-1zM3,15h1v1h-1zM5,15h1v1h-1zM6,15h1v1h-1zM11,15h1v1h-1zM13,15h1v1h-1zM14,15h1v1h-1zM16,15h1v1h-1zM17,15h1v1h-1zM18,15h1v1h-1zM19,15h1v1h-1zM22,15h1v1h-1zM23,15h1v1h-1zM24,15h1v1h-1zM25,15h1v1h-1zM27,15h1v1h-1zM28,15h1v1h-1zM29,15h1v1h-1zM33,15h1v1h-1zM34,15h1v1h-1zM2,16h1v1h-1zM3,16h1v1h-1zM5,16h1v1h-1zM7,16h1v1h-1zM8,16h1v1h-1zM11,16h1v1h-1zM13,16h1v1h-1zM14,16h1v1h-1zM15,16h1v1h-1zM19,16h1v1h-1zM21,16h1v1h-1zM24,16h1v1h-1zM26,16h1v1h-1zM27,16h1v1h-1zM28,16h1v1h-1zM30,16h1v1h-1zM31,16h1v1h-1zM32,16h1v1h-1zM33,16h1v1h-1zM4,17h1v1h-1zM5,17h1v1h-1zM6,17h1v1h-1zM7,17h1v1h-1zM11,17h1v1h-1zM12,17h1v1h-1zM14,17h1v1h-1zM15,17h1v1h-1zM18,17h1v1h-1zM21,17h1v1h-1zM22,17h1v1h-1zM23,17h1v1h-1zM24,17h1v1h-1zM25,17h1v1h-1zM26,17h1v1h-1zM27,17h1v1h-1zM28,17h1v1h-1zM31,17h1v1h-1zM32,17h1v1h-1zM3,18h1v1h-1zM4,18h1v1h-1zM5,18h1v1h-1zM6,18h1v1h-1zM8,18h1v1h-1zM11,18h1v1h-1zM12,18h1v1h-1zM18,18h1v1h-1zM19,18h1v1h-1zM21,18h1v1h-1zM22,18h1v1h-1zM24,18h1v1h-1zM26,18h1v1h-1zM27,18h1v1h-1zM29,18h1v1h-1zM30,18h1v1h-1zM34,18h1v1h-1zM5,19h1v1h-1zM6,19h1v1h-1zM9,19h1v1h-1zM10,19h1v1h-1zM11,19h1v1h-1zM12,19h1v1h-1zM15,19h1v1h-1zM18,19h1v1h-1zM19,19h1v1h-1zM21,19h1v1h-1zM22,19h1v1h-1zM25,19h1v1h-1zM26,19h1v1h-1zM27,19h1v1h-1zM28,19h1v1h-1zM29,19h1v1h-1zM31,19h1v1h-1zM32,19h1v1h-1zM34,19h1v1h-1zM2,20h1v1h-1zM3,20h1v1h-1zM4,20h1v1h-1zM7,20h1v1h-1zM8,20h1v1h-1zM9,20h1v1h-1zM10,20h1v1h-1zM11,20h1v1h-1zM12,20h1v1h-1zM13,20h1v1h-1zM14,20h1v1h-1zM15,20h1v1h-1zM16,20h1v1h-1zM17,20h1v1h-1zM19,20h1v1h-1zM22,20h1v1h-1zM24,20h1v1h-1zM29,20h1v1h-1zM30,20h1v1h-1zM32,20h1v1h-1zM33,20h1v1h-1zM2,21h1v1h-1zM4,21h1v1h-1zM6,21h1v1h-1zM12,21h1v1h-1zM16,21h1v1h-1zM17,21h1v1h-1zM18,21h1v1h-1zM19,21h1v1h-1zM20,21h1v1h-1zM22,21h1v1h-1zM25,21h1v1h-1zM27,21h1v1h-1zM28,21h1v1h-1zM29,21h1v1h-1zM30,21h1v1h-1zM31,21h1v1h-1zM32,21h1v1h-1zM33,21h1v1h-1zM2,22h1v1h-1zM5,22h1v1h-1zM6,22h1v1h-1zM8,22h1v1h-1zM9,22h1v1h-1zM10,22h1v1h-1zM11,22h1v1h-1zM12,22h1v1h-1zM13,22h1v1h-1zM14,22h1v1h-1zM16,22h1v1h-1zM17,22h1v1h-1zM18,22h1v1h-1zM22,22h1v1h-1zM23,22h1v1h-1zM24,22h1v1h-1zM27,22h1v1h-1zM30,22h1v1h-1zM31,22h1v1h-1zM33,22h1v1h-1zM34,22h1v1h-1zM2,23h1v1h-1zM4,23h1v1h-1zM6,23h1v1h-1zM12,23h1v1h-1zM13,23h1v1h-1zM15,23h1v1h-1zM17,23h1v1h-1zM20,23h1v1h-1zM25,23h1v1h-1zM28,23h1v1h-1zM31,23h1v1h-1zM34,23h1v1h-1zM2,24h1v1h-1zM4,24h1v1h-1zM6,24h1v1h-1zM7,24h1v1h-1zM8,24h1v1h-1zM10,24h1v1h-1zM11,24h1v1h-1zM13,24h1v1h-1zM14,24h1v1h-1zM16,24h1v1h-1zM17,24h1v1h-1zM18,24h1v1h-1zM19,24h1v1h-1zM20,24h1v1h-1zM22,24h1v1h-1zM23,24h1v1h-1zM27,24h1v1h-1zM30,24h1v1h-1zM33,24h1v1h-1zM2,25h1v1h-1zM4,25h1v1h-1zM5,25h1v1h-1zM6,25h1v1h-1zM7,25h1v1h-1zM10,25h1v1h-1zM13,25h1v1h-1zM14,25h1v1h-1zM15,25h1v1h-1zM16,25h1v1h-1zM17,25h1v1h-1zM20,25h1v1h-1zM23,25h1v1h-1zM24,25h1v1h-1zM26,25h1v1h-1zM27,25h1v1h-1zM28,25h1v1h-1zM30,25h1v1h-1zM31,25h1v1h-1zM32,25h1v1h-1zM2,26h1v1h-1zM7,26h1v1h-1zM8,26h1v1h-1zM11,26h1v1h-1zM13,26h1v1h-1zM14,26h1v1h-1zM17,26h1v1h-1zM18,26h1v1h-1zM19,26h1v1h-1zM24,26h1v1h-1zM26,26h1v1h-1zM27,26h1v1h-1zM28,26h1v1h-1zM29,26h1v1h-1zM30,26h1v1h-1zM33,26h1v1h-1zM34,26h1v1h-1zM10,27h1v1h-1zM12,27h1v1h-1zM14,27h1v1h-1zM15,27h1v1h-1zM18,27h1v1h-1zM20,27h1v1h-1zM21,27h1v1h-1zM22,27h1v1h-1zM23,27h1v1h-1zM25,27h1v1h-1zM26,27h1v1h-1zM30,27h1v1h-1zM32,27h1v1h-1zM34,27h1v1h-1zM2,28h1v1h-1zM3,28h1v1h-1zM4,28h1v1h-1zM5,28h1v1h-1zM6,28h1v1h-1zM7,28h1v1h-1zM8,28h1v1h-1zM11,28h1v1h-1zM13,28h1v1h-1zM17,28h1v1h-1zM18,28h1v1h-1zM20,28h1v1h-1zM23,28h1v1h-1zM25,28h1v1h-1zM26,28h1v1h-1zM28,28h1v1h-1zM30,28h1v1h-1zM32,28h1v1h-1zM2,29h1v1h-1zM8,29h1v1h-1zM10,29h1v1h-1zM11,29h1v1h-1zM12,29h1v1h-1zM16,29h1v1h-1zM18,29h1v1h-1zM21,29h1v1h-1zM22,29h1v1h-1zM23,29h1v1h-1zM24,29h1v1h-1zM25,29h1v1h-1zM26,29h1v1h-1zM30,29h1v1h-1zM31,29h1v1h-1zM32,29h1v1h-1zM34,29h1v1h-1zM2,30h1v1h-1zM4,30h1v1h-1zM5,30h1v1h-1zM6,30h1v1h-1zM8,30h1v1h-1zM10,30h1v1h-1zM12,30h1v1h-1zM13,30h1v1h-1zM14,30h1v1h-1zM16,30h1v1h-1zM20,30h1v1h-1zM21,30h1v1h-1zM23,30h1v1h-1zM26,30h1v1h-1zM27,30h1v1h-1zM28,30h1v1h-1zM29,30h1v1h-1zM30,30h1v1h-1zM31,30h1v1h-1zM2,31h1v1h-1zM4,31h1v1h-1zM5,31h1v1h-1zM6,31h1v1h-1zM8,31h1v1h-1zM10,31h1v1h-1zM12,31h1v1h-1zM15,31h1v1h-1zM16,31h1v1h-1zM17,31h1v1h-1zM18,31h1v1h-1zM19,31h1v1h-1zM22,31h1v1h-1zM24,31h1v1h-1zM25,31h1v1h-1zM27,31h1v1h-1zM30,31h1v1h-1zM31,31h1v1h-1zM32,31h1v1h-1zM34,31h1v1h-1zM2,32h1v1h-1zM4,32h1v1h-1zM5,32h1v1h-1zM6,32h1v1h-1zM8,32h1v1h-1zM10,32h1v1h-1zM12,32h1v1h-1zM13,32h1v1h-1zM16,32h1v1h-1zM19,32h1v1h-1zM20,32h1v1h-1zM21,32h1v1h-1zM24,32h1v1h-1zM25,32h1v1h-1zM26,32h1v1h-1zM27,32h1v1h-1zM28,32h1v1h-1zM29,32h1v1h-1zM32,32h1v1h-1zM2,33h1v1h-1zM8,33h1v1h-1zM14,33h1v1h-1zM15,33h1v1h-1zM18,33h1v1h-1zM21,33h1v1h-1zM22,33h1v1h-1zM23,33h1v1h-1zM28,33h1v1h-1zM30,33h1v1h-1zM31,33h1v1h-1zM32,33h1v1h-1zM2,34h1v1h-1zM3,34h1v1h-1zM4,34h1v1h-1zM5,34h1v1h-1zM6,34h1v1h-1zM7,34h1v1h-1zM8,34h1v1h-1zM10,34h1v1h-1zM11,34h1v1h-1zM12,34h1v1h-1zM14,34h1v1h-1zM19,34h1v1h-1zM20,34h1v1h-1zM21,34h1v1h-1zM24,34h1v1h-1zM25,34h1v1h-1zM26,34h1v1h-1zM29,34h1v1h-1zM33,34h1v1h-1z" fill="#2d2a26"/></svg></div><p class="scr-qr__scan">Scan to stay connected</p></div>
</div>
</div>
<p class="device__label">Carry it with you &mdash; on the go</p>
</div>

</div>

<p class="solution-caption"><strong>The GTM solution</strong>: A way to raise.</p>

---

<!-- _class: transition -->

<p class="transition-line">Here's what I built.</p>

---

<!-- _class: problem -->

<div class="beginner-badge">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# Problems

<p class="problem-statement">People love money.</p>

---

<!-- _class: cover -->

<div class="lockup">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="none" role="img" aria-label="beginner seed mark"><rect width="180" height="180" rx="40" fill="#2d5a3d"/><path d="M68 38 L68 138" stroke="#f5f3ef" stroke-width="10.5" stroke-linecap="round"/><path d="M68 82 C68 68, 82 58, 100 58 C122 58, 132 72, 132 90 C132 108, 122 122, 100 122 C82 122, 68 112, 68 98Z" stroke="#f5f3ef" stroke-width="10.5" fill="none" stroke-linejoin="round"/><path d="M68 56 C66 44, 78 34, 92 38 C88 44, 74 50, 68 56Z" fill="#7bc47a"/><path d="M68 48 C67 42, 60 38, 54 40 C56 44, 64 47, 68 48Z" fill="#5aad58" opacity="0.7"/></svg>
<span class="wm">beginner</span>
</div>

# Everyone is a founder.

<div class="hero-rainbow"></div>
