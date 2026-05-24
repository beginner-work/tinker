/* tinker — pitch-script (v0.1)
 *
 * The "prepare a script for a video" surface. Opened from the script
 * button on a pitch row in the sidebar; renders into #pitch-script.
 *
 * It is NOT a publish step. The founder isn't shipping anything to
 * the daily beginner here — this is the pre-step where they get a
 * storyboard they can record a video from. Publishing happens later
 * (today via the founders opt-in, which auto-publishes when the
 * founder makes the pitch discoverable).
 *
 * Content shape: one block per slide that has at least one resolved
 * phrase. Each block shows the deck heading, a suggested on-camera
 * duration (computed from word count at ~130 wpm), and the founder's
 * resolved phrases verbatim. Plus a copy-to-clipboard button so the
 * whole script lands in a teleprompter or notes app in one tap.
 *
 * Entry point: window.tinkerPitchScript.show(pitchId). Wired in
 * renderer.js when the sidebar script button is tapped.
 */

(() => {
  "use strict";

  const STR = {
    surfaceTitle: "Prepare a script for a video",
    back: "Back",
    copy: "Copy script",
    copied: "Copied",
    totalLabel: "Total",
    secondsAbbrev: "s",
    minutesAbbrev: "m",
    emptyHint:
      "This pitch doesn't have any resolved phrases yet. Add writing under the pitch's headings, then come back.",
  };

  let viewEl = null;
  let currentPitchId = null;
  let copiedTimer = null;

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds));
    if (s < 60) return `${s}${STR.secondsAbbrev}`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (!rem) return `${m}${STR.minutesAbbrev}`;
    return `${m}${STR.minutesAbbrev} ${rem}${STR.secondsAbbrev}`;
  }

  function getScript(pitchId) {
    const pm = window.tinkerPitches;
    if (!pm || typeof pm.getPitchScript !== "function") return null;
    return pm.getPitchScript(pitchId);
  }

  // Flat plain-text rendering for clipboard. Mirrors the on-screen
  // storyboard so the founder can paste it straight into a teleprompter
  // and read top to bottom.
  function scriptToPlainText(script) {
    if (!script) return "";
    const lines = [];
    lines.push(script.title || "");
    const total = (script.slides || []).reduce((n, s) => n + s.seconds, 0);
    if (total) lines.push(`${STR.totalLabel}: ${formatDuration(total)}`);
    lines.push("");
    (script.slides || []).forEach((slide, i) => {
      lines.push(`SLIDE ${i + 1} — ${slide.heading}  (~${formatDuration(slide.seconds)})`);
      lines.push("");
      slide.phrases.forEach((p) => {
        lines.push(p);
        lines.push("");
      });
    });
    return lines.join("\n").trimEnd() + "\n";
  }

  function render() {
    if (!viewEl) return;
    const script = currentPitchId ? getScript(currentPitchId) : null;
    if (!script) {
      viewEl.innerHTML =
        `<div class="pitch-script__inner">` +
          `<button type="button" class="pitch-script__back" data-role="back">${escapeHtml(STR.back)}</button>` +
          `<h1 class="pitch-script__title">${escapeHtml(STR.surfaceTitle)}</h1>` +
          `<p class="pitch-script__empty">${escapeHtml(STR.emptyHint)}</p>` +
        `</div>`;
      wireBack();
      return;
    }

    if (!script.slides.length) {
      viewEl.innerHTML =
        `<div class="pitch-script__inner">` +
          `<button type="button" class="pitch-script__back" data-role="back">${escapeHtml(STR.back)}</button>` +
          `<h1 class="pitch-script__title">${escapeHtml(STR.surfaceTitle)}</h1>` +
          `<div class="pitch-script__pitch-title" data-audit-ignore>${escapeHtml(script.title)}</div>` +
          `<p class="pitch-script__empty">${escapeHtml(STR.emptyHint)}</p>` +
        `</div>`;
      wireBack();
      return;
    }

    const total = script.slides.reduce((n, s) => n + s.seconds, 0);
    const slidesHtml = script.slides.map((slide, i) => {
      const phrasesHtml = slide.phrases
        .map((p) => `<p class="pitch-script__phrase" data-audit-ignore>${escapeHtml(p)}</p>`)
        .join("");
      return (
        `<section class="pitch-script__slide" aria-labelledby="pitch-script-slide-${i}">` +
          `<header class="pitch-script__slide-header">` +
            `<span class="pitch-script__slide-index">SLIDE ${i + 1}</span>` +
            `<span class="pitch-script__slide-heading" id="pitch-script-slide-${i}" data-audit-ignore>${escapeHtml(slide.heading)}</span>` +
            `<span class="pitch-script__slide-time">~${escapeHtml(formatDuration(slide.seconds))}</span>` +
          `</header>` +
          `<div class="pitch-script__slide-body">${phrasesHtml}</div>` +
        `</section>`
      );
    }).join("");

    viewEl.innerHTML =
      `<div class="pitch-script__inner">` +
        `<button type="button" class="pitch-script__back" data-role="back">${escapeHtml(STR.back)}</button>` +
        `<h1 class="pitch-script__title">${escapeHtml(STR.surfaceTitle)}</h1>` +
        `<div class="pitch-script__pitch-title" data-audit-ignore>${escapeHtml(script.title)}</div>` +
        `<div class="pitch-script__total">${escapeHtml(STR.totalLabel)}: ${escapeHtml(formatDuration(total))}</div>` +
        `<div class="pitch-script__storyboard">${slidesHtml}</div>` +
        `<div class="pitch-script__actions">` +
          `<button type="button" class="pitch-script__copy" data-role="copy">${escapeHtml(STR.copy)}</button>` +
        `</div>` +
      `</div>`;

    wireBack();
    const copyBtn = viewEl.querySelector('[data-role="copy"]');
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const text = scriptToPlainText(script);
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
          } else {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
          }
        } catch (_) { /* clipboard blocked — swallow */ }
        copyBtn.textContent = STR.copied;
        if (copiedTimer) clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => {
          copyBtn.textContent = STR.copy;
          copiedTimer = null;
        }, 1500);
      });
    }
  }

  function wireBack() {
    const back = viewEl.querySelector('[data-role="back"]');
    if (!back) return;
    back.addEventListener("click", () => {
      if (typeof window.tinkerShowPitch === "function") {
        window.tinkerShowPitch();
      }
    });
  }

  window.tinkerPitchScript = {
    show(pitchId) {
      viewEl = document.getElementById("pitch-script");
      if (!viewEl) return;
      currentPitchId = pitchId || null;
      render();
    },
    // Exposed for tests.
    _scriptToPlainText: scriptToPlainText,
    _formatDuration: formatDuration,
  };
})();
