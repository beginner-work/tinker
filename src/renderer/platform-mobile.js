/* Platform shim — runs on Capacitor (iOS/Android) and on plain web,
 * but stays out of the way when Electron's preload has already
 * installed window.tinker. Provides the same surface the renderer
 * expects, backed by a direct browser-side call to Anthropic and
 * (where available) the @capacitor/browser plugin for opening
 * external sites in the system browser overlay. */

(function () {
  if (window.tinker && typeof window.tinker.searchQuery === "function") {
    return; // Electron preload already wired things up.
  }

  const isCapacitor = !!window.Capacitor;
  document.documentElement.classList.add(isCapacitor ? "on-capacitor" : "on-web");

  const STORE = window.localStorage;
  const get = (k) => STORE.getItem(k) || "";

  // Prompts kept in sync by hand with src/main/main.js. The contract is
  // the prompt text, not the source location — if you change either one,
  // change it in both files.
  const SEARCH_SYSTEM_PROMPT = `You are the search engine for the tinker web browser — a quiet alternative to ad-driven search.

When you receive a query, write a calm, conversational answer in three to five short paragraphs that helps the reader understand the topic and where to go next. Embed Markdown links to specific, well-known websites — Wikipedia, official organisation sites, established publications, .gov pages — where the reader can read more or take action. Format links exactly as [label](https://example.com).

Voice: warm, plainspoken, calm. Address the reader as "you" where natural. No headings, no bulleted lists — just flowing prose, with short paragraphs separated by blank lines.

Only include links to sources you'd actually recommend and that you are confident exist. Do not invent URLs. If you are uncertain about a specific URL, omit the link rather than guess. It is better to write a confident paragraph with no link than to fabricate one.`;

  const CONTENT_HARNESS_SYSTEM_PROMPT = `You are the pitch-deck author for tinker's content-harness skill. You receive a structured intake — free-text company facts plus four decision answers plus targeted follow-ups — and produce a complete pitch deck in Markdown. The intake is the contract: do not ask for more, do not invent facts not provided.

# Output format

Open the deck with a single \`## Shape note\` section recording every choice from the intake: voice, investor archetype, top concern, depth, and each follow-up answer. One short paragraph, no bullets. This is the audit trail that makes re-shaping cheap.

Then render the deck. One slide per \`## Slide N — <title>\` heading. Under each slide:
- First line: a single bolded headline.
- Body: bullets or a short paragraph.
- End with a \`> \` blockquote of speaker notes (1–3 sentences).

Use \`[needs: ...]\` placeholders where the intake didn't supply a number, logo, or proof point. Never fabricate metrics, customer names, or quotes.

# Slide structure

Default order: 1. Cover · 2. Problem · 3. Solution · 4. Why now · 5. Market · 6. Product · 7. Traction · 8. Business model · 9. Team · 10. Ask.

Apply the depth from the intake:
- Short → 8 slides, drop Why now and either Market or Business model based on which is weaker for the chosen audience.
- Standard → 10–12 slides.
- Long → 15+ slides; add the appendix slides the user picked in the follow-up.

Then front-load the slide that matches the user's top concern. If top concern is Traction, move slide 7 to position 2 or 3. If Team, move slide 9. If Market, lead with slide 5. If Defensibility or Capital efficiency, weave a dedicated slide in at position 3.

# Voice rules

Pick once from the intake and hold across every headline and body line.
- **Confident** — direct, data-led, declarative. Short sentences. Lead with the strongest proof point on every slide where it fits.
- **Warm** — human, story-led, plain-spoken. Address the reader as "you" where natural. Stories before stats.
- **Technical** — precise, architecture-aware, low fluff. Concrete components and interfaces. Skip the hype words.
- **Visionary** — ambitious framing, future-tense, narrative arc. Each slide builds toward the closing ask.

# Archetype reweighting

- **Pre-seed angel** — drop Why now; expand Team to two slides if the team follow-up gives material.
- **Seed VC** — add a product screenshot beat to Solution; lead Traction with whatever the intake's signal follow-up named (paid pilots / LOIs / waitlist / prototype usage).
- **Series A VC** — expand Traction; add a slide on the GTM motion the user picked.
- **Strategic / Growth** — expand Why now and Market; add a Strategic fit slide framed by the follow-up answer.

# Top-concern emphasis

Whichever concern the user picked must show up on every slide where it's in play, anchored by the proof points from the free-text intake. Never repeat the same proof point verbatim across slides — restate it from a different angle each time.

# Constraints

- Do not invent customer names, dollar amounts, growth rates, or quotes. If the intake doesn't have one, leave a \`[needs: ...]\` placeholder.
- Do not include a market size unless the intake gave you one. If only an industry was named, frame it qualitatively.
- The Ask slide must restate the amount and use of funds from the intake exactly as given.
- Output only the deck — no preamble, no closing remarks, no "here's your deck."`;

  function getApiKey() {
    const apiKey = get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      const e = new Error(
        "ANTHROPIC_API_KEY is not set. Open Settings to add it (or run localStorage.setItem from the inspector)."
      );
      e.code = "MISSING_API_KEY";
      throw e;
    }
    return apiKey;
  }

  async function callAnthropic(apiKey, body) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${errBody.slice(0, 240)}`);
    }
    return res.json();
  }

  async function searchQuery(query) {
    const apiKey = getApiKey();
    const data = await callAnthropic(apiKey, {
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SEARCH_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: query.trim() }],
    });
    const textBlock = (data.content || []).find((b) => b.type === "text");
    return { text: textBlock ? textBlock.text : "", usage: data.usage };
  }

  async function contentHarnessGenerate(intake) {
    if (!intake || typeof intake !== "object") {
      throw new Error("intake is required");
    }
    const { decisions } = intake;
    if (!decisions || !decisions.voice || !decisions.archetype ||
        !decisions.topConcern || !decisions.depth) {
      throw new Error(
        "intake.decisions must include voice, archetype, topConcern, and depth"
      );
    }
    const apiKey = getApiKey();
    const data = await callAnthropic(apiKey, {
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text: CONTENT_HARNESS_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content:
            "Generate the pitch deck from this intake:\n\n" +
            JSON.stringify(intake, null, 2),
        },
      ],
    });
    const textBlock = (data.content || []).find((b) => b.type === "text");
    return { markdown: textBlock ? textBlock.text : "", usage: data.usage };
  }

  async function openExternal(url) {
    if (isCapacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
      try {
        await window.Capacitor.Plugins.Browser.open({ url });
        return;
      } catch {
        // fall through to window.open
      }
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  window.tinker = {
    version: () => Promise.resolve("0.1.0-mobile"),
    platform: () => Promise.resolve(isCapacitor ? "capacitor" : "web"),
    setIcon: () => Promise.resolve(true),
    searchQuery,
    contentHarnessGenerate,
    openExternal,
    supportsWebview: false,
    setSetting: (k, v) => {
      STORE.setItem(k, v);
      return Promise.resolve(true);
    },
    getSetting: (k) => Promise.resolve(get(k)),
  };
})();
