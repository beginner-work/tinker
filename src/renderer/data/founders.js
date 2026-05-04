/* Seed data for the founder feed / reels / profiles.
 *
 * The pitch decks in this repo describe a marketplace where founders
 * show their work and investors fund what they want, on the founder's
 * stated terms. These six founders are the cohort the deck talks
 * about: a Latina spiritual guide, an ex-eng manager, a Filipino
 * non-profit CEO, a men's-health-curious tech founder, and the
 * platform's own founder (hop tinctures, career coaching).
 *
 * Posts are split into two shapes:
 *   - `posts`: square, Instagram-style (image + caption + ask)
 *   - `reels`: vertical, TikTok-style (caption + soundbite + ask)
 *
 * Images are CSS gradients keyed off the founder's palette — there
 * is no network image fetch, the renderer paints them. */

(function () {
  "use strict";

  const FOUNDERS = [
    {
      handle: "luz_de_mar",
      name: "Luz Marín",
      tagline: "Latina spiritual guide · herbalist",
      city: "Oakland, CA",
      avatarHue: 18,
      palette: ["#f9a8d4", "#fdba74", "#fde68a"],
      bio:
        "Curandera in the East Bay tradition. I make tinctures, hold sound baths, and walk people through grief that pharma can't touch. My grandmother taught me. Now I'm scaling the practice without losing it.",
      offerings: [
        { title: "Sound bath, group of 8", price: 240 },
        { title: "Bitters & nervines, 30ml", price: 28 },
        { title: "Grief walk, 1:1, 90 min", price: 175 },
      ],
      ask: { amount: 35000, terms: "Revenue share — 8% of bookings, 36 months, capped at 1.6×" },
      principles: [
        "I will not whitewash the tradition to make a deck cleaner.",
        "Plants come from named growers, paid above market.",
      ],
      followers: 4128,
      following: 213,
      funded: 2150,
    },
    {
      handle: "marco.builds",
      name: "Marco Aoyama",
      tagline: "Ex-eng manager · first-time founder",
      city: "Brooklyn, NY",
      avatarHue: 220,
      palette: ["#a5b4fc", "#7dd3fc", "#c8b6e2"],
      bio:
        "Spent 9 years shipping infra at a payments network. Quit to build a small tool for solo accountants — invoicing that doesn't punish you for being one person. Filipino-Irish, hapa, learning out loud.",
      offerings: [
        { title: "Solo accountant invoicing tool · monthly", price: 19 },
        { title: "Onboarding session, white-glove", price: 250 },
      ],
      ask: { amount: 120000, terms: "SAFE, $4M post-money cap, no MFN, no pro-rata" },
      principles: [
        "No engagement metrics in the product. Time spent is not the goal.",
        "I will publish my churn every month.",
      ],
      followers: 2871,
      following: 304,
      funded: 18500,
    },
    {
      handle: "ate.imelda",
      name: "Imelda Reyes",
      tagline: "Filipino-market non-profit CEO",
      city: "San Diego, CA",
      avatarHue: 142,
      palette: ["#7bc47a", "#6ee7b7", "#fde68a"],
      bio:
        "I run a non-profit serving Filipino home-care workers in SD. Our job board, our credit-builder, our after-hours legal clinic — all of it. Now turning the playbook into an LLC so we can pay the staff what they're worth.",
      offerings: [
        { title: "Membership, sliding scale", price: 12 },
        { title: "Caregiver credential prep", price: 90 },
        { title: "Group legal clinic, drop-in", price: 0 },
      ],
      ask: { amount: 80000, terms: "Recoverable grant, 0% if mission unmet, 1× if met" },
      principles: [
        "Workers vote on hires.",
        "Every dollar in is reported quarterly, by name.",
      ],
      followers: 6240,
      following: 488,
      funded: 12200,
    },
    {
      handle: "jay_after_ten",
      name: "Jay Okafor",
      tagline: "Second-time founder · men's health practice",
      city: "Atlanta, GA",
      avatarHue: 280,
      palette: ["#c8b6e2", "#a5b4fc", "#f9a8d4"],
      bio:
        "Sold a B2B tool in 2022. Spent the year after in therapy figuring out who I am when I'm not pitching. Building a men's health practice — somatic work, sleep, meaningful labor — for the next ten years of my life.",
      offerings: [
        { title: "Intro call, 1:1, 45 min", price: 0 },
        { title: "Eight-week container, men's group", price: 720 },
        { title: "Quarterly intensive, weekend", price: 1400 },
      ],
      ask: { amount: 60000, terms: "Equity — 6% common, 4-year vest, 1-year cliff" },
      principles: [
        "I will not run growth tactics that prey on lonely men.",
        "Cohort caps at 12. The number is the product.",
      ],
      followers: 3905,
      following: 198,
      funded: 7300,
    },
    {
      handle: "hops.and.hours",
      name: "the founder",
      tagline: "hop tinctures · career coaching · this platform",
      city: "San Diego, CA",
      avatarHue: 90,
      palette: ["#7bc47a", "#fdba74", "#7dd3fc"],
      bio:
        "I sell hop tinctures. I coach careers. I am building this platform alone, in public. My barber gave me $100 because he believes in me, not because he read a deck. If you want to know whether the founder can run the platform, look at the platform — I did.",
      offerings: [
        { title: "Hop tincture, 30ml dropper", price: 25 },
        { title: "Career coaching, foundation session", price: 125 },
        { title: "Platform — base subscription, monthly", price: 7 },
      ],
      ask: { amount: 300000, terms: "One-year solo runway. No office, no hires. Salary + benefits." },
      principles: [
        "Fund the person, the practice, and the offering — as they actually are, today.",
        "The platform earns when the founder earns. Nobody pays to list.",
      ],
      followers: 12_410,
      following: 612,
      funded: 295,
    },
    {
      handle: "rae.weaves",
      name: "Rae Tomlin",
      tagline: "Fiber artist · slow studio",
      city: "Hudson, NY",
      avatarHue: 340,
      palette: ["#fdba74", "#f9a8d4", "#fde68a"],
      bio:
        "I weave on a 1940s loom my grandfather rebuilt. Six pieces a year. Every piece has a name. I am asking for capital so I can pay myself a salary while I write the book on what slow business looks like at scale.",
      offerings: [
        { title: "Commissioned weaving, named series", price: 2400 },
        { title: "Studio visit, 90 min, by appointment", price: 0 },
        { title: "Book, pre-order signed", price: 38 },
      ],
      ask: { amount: 45000, terms: "Patron model — $25/mo per patron, no equity, lifetime credit" },
      principles: [
        "Pieces are not produced in batches.",
        "Patrons get the studio's actual P&L every quarter.",
      ],
      followers: 1872,
      following: 122,
      funded: 4100,
    },
  ];

  /** Posts surface as Instagram-style cards. Each post belongs to a founder. */
  const POSTS = [
    {
      id: "p1",
      handle: "luz_de_mar",
      kind: "offering",
      caption:
        "Three bottles left from the autumn batch. Hops, oat, lemon balm. For when the body forgets how to land.",
      tag: "OFFERING · $28",
      imageMood: "tincture",
      likes: 218,
      comments: 14,
      hours: 3,
    },
    {
      id: "p2",
      handle: "marco.builds",
      kind: "ask",
      caption:
        "Asking $120K on a $4M cap SAFE. No MFN. No pro-rata. The number is small on purpose — I want investors who fund the practice, not the round.",
      tag: "ASK · $120,000 SAFE",
      imageMood: "grid",
      likes: 412,
      comments: 39,
      hours: 7,
    },
    {
      id: "p3",
      handle: "ate.imelda",
      kind: "milestone",
      caption:
        "200 caregivers credentialed this quarter. 48 hired into roles paying above $24/hr. We do not run growth experiments on workers.",
      tag: "MILESTONE",
      imageMood: "wave",
      likes: 1024,
      comments: 73,
      hours: 11,
    },
    {
      id: "p4",
      handle: "jay_after_ten",
      kind: "principle",
      caption:
        "Cohort caps at 12. The number is the product. If the cohort is twenty, the cohort is not the cohort anymore.",
      tag: "PRINCIPLE",
      imageMood: "circle",
      likes: 689,
      comments: 51,
      hours: 18,
    },
    {
      id: "p5",
      handle: "hops.and.hours",
      kind: "proof",
      caption:
        "$295 in. My barber. Two hop tinctures. One coaching session. The proof isn't volume — it's that the rails work on a real human at the actual unit economics.",
      tag: "PROOF · $295 funded",
      imageMood: "ledger",
      likes: 873,
      comments: 64,
      hours: 22,
    },
    {
      id: "p6",
      handle: "rae.weaves",
      kind: "offering",
      caption:
        "Commission slot opening for piece #38, the autumn series. 8 weeks on the loom. Named after the patron's grandmother by request.",
      tag: "OFFERING · $2,400",
      imageMood: "weave",
      likes: 304,
      comments: 22,
      hours: 26,
    },
    {
      id: "p7",
      handle: "luz_de_mar",
      kind: "principle",
      caption:
        "I will not whitewash the tradition to make a deck cleaner. The plants come from named growers paid above market. That's the line.",
      tag: "PRINCIPLE",
      imageMood: "leaf",
      likes: 478,
      comments: 31,
      hours: 31,
    },
    {
      id: "p8",
      handle: "marco.builds",
      kind: "milestone",
      caption:
        "Crossed 200 paid solo accountants this morning. Churn this month: 1.8%. Publishing the spreadsheet on the profile, as promised.",
      tag: "MILESTONE",
      imageMood: "grid",
      likes: 511,
      comments: 28,
      hours: 36,
    },
    {
      id: "p9",
      handle: "ate.imelda",
      kind: "ask",
      caption:
        "Recoverable grant, $80K. We pay it back at 1× if the mission is met. We don't if it isn't. The terms are the disclosure.",
      tag: "ASK · $80,000 grant",
      imageMood: "wave",
      likes: 902,
      comments: 81,
      hours: 49,
    },
    {
      id: "p10",
      handle: "jay_after_ten",
      kind: "offering",
      caption:
        "Eight-week container, men's group. Twelve seats. Three left. Somatic, sleep, meaningful labor — in that order.",
      tag: "OFFERING · $720",
      imageMood: "circle",
      likes: 421,
      comments: 33,
      hours: 58,
    },
    {
      id: "p11",
      handle: "hops.and.hours",
      kind: "principle",
      caption:
        "The platform earns when the founder earns. Nobody pays to list. The take rate is 5/7/9% on funded dollars — non-optional, and honest about it.",
      tag: "PRINCIPLE",
      imageMood: "ledger",
      likes: 1240,
      comments: 109,
      hours: 71,
    },
    {
      id: "p12",
      handle: "rae.weaves",
      kind: "proof",
      caption:
        "Forty patrons at $25/mo. That's a salary. Quietly, no launch, no funnel — just people who wanted the studio's P&L every quarter.",
      tag: "PROOF · 40 patrons",
      imageMood: "weave",
      likes: 256,
      comments: 19,
      hours: 88,
    },
  ];

  /** Reels are TikTok-style vertical cards. Same founders, different shape. */
  const REELS = [
    {
      id: "r1",
      handle: "hops.and.hours",
      title: "If it works at $295, it works at $295,000.",
      hook:
        "The proof isn't volume. The proof is that the mechanic works on a real human at the actual unit economics.",
      sound: "original — the founder",
      bgMood: "ledger",
      likes: 4_120,
      comments: 189,
      shares: 612,
      saves: 980,
      duration: "0:48",
    },
    {
      id: "r2",
      handle: "luz_de_mar",
      title: "What a curandera does that pharma can't.",
      hook:
        "Grief isn't a deficiency in serotonin. Grief is a relationship with someone who isn't here. The plants don't fix it. They make room.",
      sound: "ambient · cuencos de cuarzo",
      bgMood: "leaf",
      likes: 12_300,
      comments: 442,
      shares: 2_100,
      saves: 3_400,
      duration: "1:14",
    },
    {
      id: "r3",
      handle: "marco.builds",
      title: "I won't put engagement metrics in the product.",
      hook:
        "Time spent is not the goal. The goal is that you close the laptop and your invoices went out. That's the win condition.",
      sound: "original — marco",
      bgMood: "grid",
      likes: 8_402,
      comments: 311,
      shares: 1_402,
      saves: 1_801,
      duration: "0:39",
    },
    {
      id: "r4",
      handle: "jay_after_ten",
      title: "I sold a company. Then I went to therapy.",
      hook:
        "I had to figure out who I was when I wasn't pitching. The men's group is the answer I built for me first. Now twelve other men a quarter.",
      sound: "original — jay",
      bgMood: "circle",
      likes: 21_440,
      comments: 1_230,
      shares: 4_500,
      saves: 6_120,
      duration: "1:02",
    },
    {
      id: "r5",
      handle: "ate.imelda",
      title: "Workers vote on hires. That's the policy.",
      hook:
        "If we hire someone the caregivers won't work for, we don't hire them. The org chart is downstream of the people the work serves.",
      sound: "original — imelda",
      bgMood: "wave",
      likes: 16_900,
      comments: 808,
      shares: 3_200,
      saves: 4_010,
      duration: "0:55",
    },
    {
      id: "r6",
      handle: "rae.weaves",
      title: "Six pieces a year. Every piece has a name.",
      hook:
        "Slow at scale isn't an oxymoron. It's a different scale. I'm raising so I can pay myself while I write the book that says so.",
      sound: "loom · 1947 hattersley",
      bgMood: "weave",
      likes: 5_640,
      comments: 240,
      shares: 880,
      saves: 1_320,
      duration: "1:21",
    },
  ];

  /* Founder-match cards. Explicitly NOT co-founder matching — there is
   * no "would you start a company together" question on this surface.
   * The premise is that founders are already running their own work;
   * the match is for working *relationships* across them: referrals,
   * residencies, shared studios, swapped offerings, mutual seeding,
   * patron introductions. The deck cycles one card at a time, and
   * the only actions are the four ways the platform names the work
   * you'd actually do together. */

  const MATCHES = [
    {
      id: "m1",
      seekerHandle: "hops.and.hours",
      otherHandle: "luz_de_mar",
      kinds: ["refer-clients", "swap-offerings"],
      why:
        "Both of you sell tinctures. Both of you do 1:1 work that isn't therapy and isn't medicine. A career-coaching client who is grieving belongs in a sound bath before the next session, not after the round closes.",
      overlap: "tincture · 1:1 practice · San Diego ↔ Oakland",
      readiness: 92,
    },
    {
      id: "m2",
      seekerHandle: "marco.builds",
      otherHandle: "ate.imelda",
      kinds: ["build-for", "share-numbers"],
      why:
        "Marco's invoicing tool was built for solo accountants. Imelda's caregivers run their own books. A free tier for the non-profit's members, in exchange for the kind of feedback that doesn't come from a typical funnel.",
      overlap: "small-business tooling · Filipino-led · monthly cadence",
      readiness: 88,
    },
    {
      id: "m3",
      seekerHandle: "jay_after_ten",
      otherHandle: "rae.weaves",
      kinds: ["residency", "swap-offerings"],
      why:
        "Jay runs men's-health intensives. Rae runs a slow studio with a guest room and a loom. A weekend residency where the cohort weaves while they talk — neither of you trying to convert the other into something they aren't.",
      overlap: "long-form work · cohorts of twelve · reverence for time",
      readiness: 81,
    },
    {
      id: "m4",
      seekerHandle: "ate.imelda",
      otherHandle: "luz_de_mar",
      kinds: ["refer-clients", "patron-intro"],
      why:
        "Imelda's members are care workers, mostly women, mostly running on empty. Luz's grief walks and group sound baths exist for exactly this. Sliding-scale slots reserved monthly, in exchange for an intro to the patron list.",
      overlap: "care worker community · sliding scale · grief-literate",
      readiness: 95,
    },
    {
      id: "m5",
      seekerHandle: "rae.weaves",
      otherHandle: "hops.and.hours",
      kinds: ["share-numbers", "patron-intro"],
      why:
        "Rae publishes the studio's quarterly P&L to her patrons. The platform's founder publishes funded dollars in public. A guest essay, swapped both ways, that shows what radical-disclosure economics looks like at studio scale and at platform scale.",
      overlap: "in-public numbers · patron model · slow growth",
      readiness: 84,
    },
    {
      id: "m6",
      seekerHandle: "marco.builds",
      otherHandle: "jay_after_ten",
      kinds: ["build-for", "residency"],
      why:
        "Marco won't put engagement metrics in his product. Jay won't run growth tactics that prey on lonely men. Different industries, same line in the sand. A working session — quarterly — to keep each other honest about that line as the businesses scale.",
      overlap: "no-dark-patterns · founder integrity · long horizon",
      readiness: 90,
    },
  ];

  /** Human labels for the four kinds of working relationships the
   * Match surface knows about. The list is closed on purpose — the
   * point is to name the work, not to leave it to interpretation. */
  const MATCH_KINDS = {
    "refer-clients": { label: "Refer clients", glyph: "→" },
    "swap-offerings": { label: "Swap offerings", glyph: "⇄" },
    "build-for": { label: "Build for each other", glyph: "⌬" },
    "share-numbers": { label: "Share numbers", glyph: "%" },
    "residency": { label: "Studio residency", glyph: "◐" },
    "patron-intro": { label: "Intro the patron list", glyph: "✦" },
  };

  window.tinkerData = { FOUNDERS, POSTS, REELS, MATCHES, MATCH_KINDS };
})();
