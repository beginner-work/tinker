/* Platform shim — runs on Capacitor (iOS/Android) and on plain web,
 * but stays out of the way when Electron's preload has already
 * installed window.beginner. Provides the same surface the renderer
 * expects, backed by direct browser-side calls to Anthropic / LinkedIn
 * and (where available) the @capacitor/browser plugin for opening
 * external sites in the system browser overlay. */

(function () {
  if (window.beginner && typeof window.beginner.navigateTo === "function") {
    return; // Electron preload already wired things up.
  }

  const isCapacitor = !!window.Capacitor;
  document.documentElement.classList.add(isCapacitor ? "on-capacitor" : "on-web");

  const STORE = window.localStorage;
  const get = (k) => STORE.getItem(k) || "";

  // Same prompt + tool the desktop main process uses. Kept in sync by hand —
  // the contract is the prompt, not the source location. If you change
  // it in src/main/main.js, change it here too.
  const NAV_SYSTEM_PROMPT = `You are the smart-navigation engine for the beginner web browser — a quiet alternative to result-list search.

The reader hands you a description of where they want to be. You answer with one URL: the closest existing web page that matches what they said. There is no result list, no ranking, no snippet — the reader sees the page itself.

You will receive a description chain (oldest → newest). On the first jump the chain has one entry. When the reader refines, the chain grows; treat the most recent entry as the strongest signal and the older ones as the surrounding intent. You will also receive the URL the reader is currently on, when there is one — use it to understand what they're moving away from, not as a place to return to.

Pick a real, canonical web page you are confident about: Wikipedia entries, official organisation sites, established publications, government pages, well-known reference works. Never invent a URL. If you can't pin down a specific page you trust, fall back to a canonical landing page (a homepage, a section index, a topic hub) you do trust — better a sturdy general page than a fabricated specific one.

Always answer by calling the arrive_at_page tool. Do not write any prose outside the tool call.`;

  const NAVIGATE_TOOL = {
    name: "arrive_at_page",
    description:
      "Land the reader on a single existing web page that best matches their description chain.",
    input_schema: {
      type: "object",
      required: ["url", "title", "note"],
      properties: {
        url: {
          type: "string",
          description: "Full https:// URL of a real, existing web page.",
        },
        title: {
          type: "string",
          description: "Three to six words naming what's at that URL.",
        },
        note: {
          type: "string",
          description:
            "One calm, plainspoken sentence about what the reader will find there.",
        },
      },
    },
  };

  function formatNavUserMessage({ descriptions, currentUrl }) {
    const lines = ["Description chain (oldest → newest):"];
    descriptions.forEach((d, i) => lines.push(`${i + 1}. ${d}`));
    if (currentUrl && /^https?:\/\//i.test(currentUrl)) {
      lines.push("", `Currently on: ${currentUrl}`);
    }
    return lines.join("\n");
  }

  const LINKEDIN_TAGLINE = "made by me, supported by beginner";

  async function navigateTo(input) {
    const descriptions = Array.isArray(input && input.descriptions)
      ? input.descriptions.map((d) => String(d || "").trim()).filter(Boolean)
      : [];
    if (descriptions.length === 0) {
      throw new Error("A description is required");
    }
    const currentUrl = typeof input.currentUrl === "string" ? input.currentUrl : "";

    const apiKey = get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      const e = new Error(
        "ANTHROPIC_API_KEY is not set. Open Settings to add it (or run localStorage.setItem from the inspector)."
      );
      e.code = "MISSING_API_KEY";
      throw e;
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 512,
        system: [
          {
            type: "text",
            text: NAV_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: [NAVIGATE_TOOL],
        tool_choice: { type: "tool", name: NAVIGATE_TOOL.name },
        messages: [
          {
            role: "user",
            content: formatNavUserMessage({ descriptions, currentUrl }),
          },
        ],
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${errBody.slice(0, 240)}`);
    }
    const data = await res.json();
    const toolUse = (data.content || []).find(
      (b) => b.type === "tool_use" && b.name === NAVIGATE_TOOL.name
    );
    if (!toolUse || !toolUse.input || !toolUse.input.url) {
      throw new Error("Couldn't find a page that matches that description.");
    }
    return {
      url: String(toolUse.input.url),
      title: String(toolUse.input.title || ""),
      note: String(toolUse.input.note || ""),
      usage: data.usage,
    };
  }

  async function linkedinPost(message) {
    const token = get("LINKEDIN_ACCESS_TOKEN");
    const author = get("LINKEDIN_AUTHOR_URN");
    if (!token || !author) {
      const e = new Error(
        "LINKEDIN_ACCESS_TOKEN and LINKEDIN_AUTHOR_URN must be set in your settings."
      );
      e.code = "MISSING_LINKEDIN_CREDS";
      throw e;
    }
    const fullText = `${message.trim()}\n\n— ${LINKEDIN_TAGLINE}`;
    const body = {
      author,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: fullText },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };
    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`LinkedIn API ${res.status}: ${errBody.slice(0, 240)}`);
    }
    const postUrn = res.headers.get("x-restli-id") || (await res.json()).id;
    const url = postUrn
      ? `https://www.linkedin.com/feed/update/${postUrn}/`
      : null;
    return { ok: true, postUrn, url, posted: fullText };
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

  window.beginner = {
    version: () => Promise.resolve("0.1.0-mobile"),
    platform: () => Promise.resolve(isCapacitor ? "capacitor" : "web"),
    setIcon: () => Promise.resolve(true),
    navigateTo,
    linkedinPost,
    openExternal,
    supportsWebview: false,
    setSetting: (k, v) => {
      STORE.setItem(k, v);
      return Promise.resolve(true);
    },
    getSetting: (k) => Promise.resolve(get(k)),
  };
})();
