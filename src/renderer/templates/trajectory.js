/* tinker — trajectory page logic
 *
 * The hard line (product-spec §8): no AI authoring on this page.
 * Everything below is template substitution. We take a payload of
 * verbatim quotes from the founder's transcript and drop them into
 * fixed slots. We never generate text; we never modify a quote.
 * If a slot is missing, the section hides — no placeholder, no
 * "AI completed your thought."
 *
 * Payload sources, in order of preference:
 *   1. window.parent.__tinkerPayload  (set by parent renderer before mount)
 *   2. URL hash:  #payload=<base64-json>
 *   3. URL query: ?example=1          (loads the bundled example payload)
 *
 * The page also renders the share URL into the close slide. That URL
 * is whatever the parent passes in via __tinkerShareUrl, or, for
 * standalone use, the current page URL.
 */

(() => {
  "use strict";

  const EXAMPLE_PAYLOAD = {
    start_feeling: "I woke up scared this thing wouldn't be real.",
    idea_in_their_words:
      "I want a place where I can just show what I make.\nThe people who already love me can fund what I'm doing without me asking.",
    forward_feeling: "I just want to keep building.",
    quoted_lines: [
      "My barber gave me a hundred dollars.",
      "If it works for me it works.",
      "I'm not pretending anymore."
    ],
    chosen_colors: null,
  };

  const EXAMPLE_SHARE_URL = "https://beginner-work.github.io/beginner/example";

  function getPayload() {
    const params = new URLSearchParams(location.search);
    const isExample = params.get("example") === "1";

    // 1. Example mode wins so the on-screen example iframe never picks
    // up a founder payload that happens to be sitting on the parent.
    if (isExample) {
      return { payload: EXAMPLE_PAYLOAD, shareUrl: EXAMPLE_SHARE_URL, embedded: true };
    }
    // 2. Parent injection (the live recording flow).
    try {
      if (window.parent && window.parent !== window && window.parent.__tinkerPayload) {
        return {
          payload: window.parent.__tinkerPayload,
          shareUrl: window.parent.__tinkerShareUrl || null,
          embedded: true,
        };
      }
    } catch {
      // Cross-origin parent — ignore.
    }
    // 3. URL hash (for standalone publishing later).
    if (location.hash.startsWith("#payload=")) {
      try {
        const json = atob(decodeURIComponent(location.hash.slice("#payload=".length)));
        return { payload: JSON.parse(json), shareUrl: null, embedded: false };
      } catch {
        // fall through
      }
    }
    return { payload: null, shareUrl: null, embedded: false };
  }

  function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
  }

  function fillSingleSlot(slotName, value) {
    const slide = document.querySelector(`[data-slot="${slotName}"]`);
    const target = document.querySelector(`[data-fill="${slotName}"]`);
    if (!slide || !target) return false;
    if (!isNonEmptyString(value)) {
      slide.hidden = true;
      return false;
    }
    target.textContent = value.trim();
    slide.hidden = false;
    return true;
  }

  function fillLinesSlot(slotName, value) {
    const slide = document.querySelector(`[data-slot="${slotName}"]`);
    const target = document.querySelector(`[data-fill-lines="${slotName}"]`);
    if (!slide || !target) return false;
    if (!isNonEmptyString(value)) {
      slide.hidden = true;
      return false;
    }
    target.replaceChildren();
    const lines = value.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      slide.hidden = true;
      return false;
    }
    for (const line of lines) {
      const p = document.createElement("p");
      p.textContent = line;
      target.appendChild(p);
    }
    slide.hidden = false;
    return true;
  }

  function fillListSlot(slotName, value) {
    const slide = document.querySelector(`[data-slot="${slotName}"]`);
    const target = document.querySelector(`[data-fill-list="${slotName}"]`);
    if (!slide || !target) return false;
    const items = Array.isArray(value) ? value.filter(isNonEmptyString) : [];
    if (items.length === 0) {
      slide.hidden = true;
      return false;
    }
    target.replaceChildren();
    for (const item of items.slice(0, 5)) {
      const li = document.createElement("li");
      li.textContent = item.trim();
      target.appendChild(li);
    }
    slide.hidden = false;
    return true;
  }

  function setShareUrl(shareUrl) {
    const input = document.getElementById("share-url");
    const button = document.getElementById("copy-link");
    if (!input || !button) return;
    const url = shareUrl || location.href;
    input.value = url;
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        input.select();
        document.execCommand && document.execCommand("copy");
      }
      const original = button.textContent;
      button.textContent = "Copied";
      button.dataset.copied = "1";
      setTimeout(() => {
        button.textContent = original;
        delete button.dataset.copied;
      }, 1600);
    });
  }

  function setCoverDate() {
    const el = document.getElementById("cover-date");
    if (!el) return;
    try {
      const d = new Date();
      el.textContent = d.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
    } catch {
      el.textContent = "";
    }
  }

  function render(payload) {
    const root = document.getElementById("trajectory");
    setCoverDate();

    const filled = [
      fillSingleSlot("start_feeling", payload.start_feeling),
      fillLinesSlot("idea_in_their_words", payload.idea_in_their_words),
      fillListSlot("quoted_lines", payload.quoted_lines),
      fillSingleSlot("forward_feeling", payload.forward_feeling),
    ].some(Boolean);

    if (!filled) {
      const empty = document.getElementById("empty");
      if (empty) empty.hidden = false;
    }

    root.dataset.state = "ready";
  }

  function renderEmpty() {
    const empty = document.getElementById("empty");
    if (empty) empty.hidden = false;
    document.getElementById("trajectory").dataset.state = "ready";
  }

  // Boot.
  const { payload, shareUrl, embedded } = getPayload();
  if (embedded) document.body.classList.add("embedded");
  if (payload) {
    render(payload);
    setShareUrl(shareUrl);
  } else {
    renderEmpty();
    setShareUrl(null);
  }

  // Late-arriving payload via postMessage (from parent renderer mounting
  // an iframe before navigation completes). Ignored when this iframe is
  // the on-screen example — the example renders one fixed payload.
  const isExampleFrame = new URLSearchParams(location.search).get("example") === "1";
  window.addEventListener("message", (e) => {
    if (isExampleFrame) return;
    if (!e.data || e.data.type !== "trajectory:payload") return;
    const next = e.data.payload;
    const url = e.data.shareUrl || null;
    if (next) {
      const empty = document.getElementById("empty");
      if (empty) empty.hidden = true;
      // Reset all slides hidden, then re-render.
      document.querySelectorAll("[data-slot]").forEach((s) => (s.hidden = true));
      render(next);
    }
    if (url) {
      const input = document.getElementById("share-url");
      if (input) input.value = url;
    }
  });

  // Tell parent we're ready (so it can hand us a payload if it has one).
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: "trajectory:ready" }, "*");
    }
  } catch {
    // standalone — fine
  }
})();
