/* publish-stories.js — "Publish stories" booklet picker.
 *
 * tinker stays private. This is the one seam where a founder chooses to
 * make some of their writing public: they pick which pitches to surface,
 * and the full essays behind those pitches publish as a "booklet" to
 * their public beginner profile page (/tyler-lindow → Stories tab).
 *
 * Flow:
 *   1. The sidebar "Publish stories" button opens a modal.
 *   2. The modal lists every pitch that has at least one resolved story
 *      (window.tinkerPitches.getPitchStories), each with a checkbox and a
 *      story count. The founder ticks the ones they want public.
 *   3. "Publish to my profile" POSTs the chosen pitches + their stories to
 *      /api/publish/booklet and shows the shareable profile link on success.
 *
 * Re-publishing replaces the whole booklet, so unticking a pitch and
 * publishing again removes it from the public profile.
 */

(function () {
  "use strict";

  var TOKEN_KEY = "tinker_jwt";

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (e) { return ""; }
  }

  // Pitches with at least one resolved story, newest-feeling first (we
  // keep getPitches' order, which is the switcher's robustness order).
  function collectPitches() {
    var pm = window.tinkerPitches;
    if (!pm || typeof pm.getPitches !== "function" || typeof pm.getPitchStories !== "function") {
      return [];
    }
    var out = [];
    var all = pm.getPitches() || [];
    for (var i = 0; i < all.length; i++) {
      var resolved = pm.getPitchStories(all[i].id);
      if (resolved && resolved.stories && resolved.stories.length) {
        out.push(resolved);
      }
    }
    return out;
  }

  // ── Modal ──────────────────────────────────────────────────────────────
  var overlay = null;

  function close() {
    if (!overlay) return;
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
    overlay = null;
  }

  function onKeydown(e) {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
  }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function open() {
    close();

    overlay = el("div", "publish-stories-overlay");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Publish stories to your profile");

    var backdrop = el("div", "publish-stories-overlay__backdrop");
    backdrop.addEventListener("click", close);
    overlay.appendChild(backdrop);

    var panel = el("div", "publish-stories-overlay__panel");

    var closeBtn = el("button", "publish-stories-overlay__close", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", close);
    panel.appendChild(closeBtn);

    panel.appendChild(el("h2", "publish-stories__title", "Publish stories to your profile"));
    panel.appendChild(el(
      "p",
      "publish-stories__lede",
      "Pick the pitches you want to make public. The full essays behind them publish to your beginner profile, where anyone you share it with can read them. tinker itself stays private."
    ));

    var body = el("div", "publish-stories__body");
    panel.appendChild(body);

    if (!token()) {
      body.appendChild(el("p", "publish-stories__note", "Sign in to publish your stories."));
      overlay.appendChild(panel);
      mount();
      return;
    }

    var pitches = collectPitches();
    if (!pitches.length) {
      body.appendChild(el(
        "p",
        "publish-stories__note",
        "None of your pitches have a story behind them yet. Write a few drafts, let tinker place them into a pitch, then come back."
      ));
      overlay.appendChild(panel);
      mount();
      return;
    }

    var list = el("ul", "publish-stories__list");
    pitches.forEach(function (pitch, idx) {
      var li = el("li", "publish-stories__item");
      var label = el("label", "publish-stories__option");

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.value = String(idx);
      cb.className = "publish-stories__checkbox";
      label.appendChild(cb);

      var meta = el("span", "publish-stories__meta");
      meta.appendChild(el("span", "publish-stories__pitch-title", pitch.title || "Untitled"));
      var n = pitch.stories.length;
      meta.appendChild(el(
        "span",
        "publish-stories__count",
        n === 1 ? "1 story" : n + " stories"
      ));
      label.appendChild(meta);

      li.appendChild(label);
      list.appendChild(li);
    });
    body.appendChild(list);

    var actions = el("div", "publish-stories__actions");
    var publishBtn = el("button", "publish-stories__publish", "Publish to my profile");
    publishBtn.type = "button";
    actions.appendChild(publishBtn);
    var statusEl = el("p", "publish-stories__status");
    statusEl.setAttribute("role", "status");
    statusEl.setAttribute("aria-live", "polite");
    actions.appendChild(statusEl);
    panel.appendChild(actions);

    publishBtn.addEventListener("click", function () {
      var chosen = [];
      var boxes = list.querySelectorAll(".publish-stories__checkbox");
      Array.prototype.forEach.call(boxes, function (box) {
        if (box.checked) {
          var p = pitches[Number(box.value)];
          if (p) chosen.push({ title: p.title, stories: p.stories });
        }
      });
      if (!chosen.length) {
        statusEl.textContent = "Pick at least one pitch to publish.";
        return;
      }
      publishBtn.disabled = true;
      statusEl.textContent = "Publishing…";
      publish(chosen).then(function (result) {
        publishBtn.disabled = false;
        if (result.ok) {
          showPublished(panel, result);
        } else {
          statusEl.textContent = result.error || "Couldn't publish just now. Please try again.";
        }
      });
    });

    overlay.appendChild(panel);
    mount();
  }

  function mount() {
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKeydown, true);
    var first = overlay.querySelector(".publish-stories-overlay__close");
    setTimeout(function () { try { first.focus(); } catch (e) { /* ignore */ } }, 0);
  }

  function publish(pitches) {
    return fetch("/api/publish/booklet", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token(),
      },
      body: JSON.stringify({ pitches: pitches }),
    })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (json) {
          if (!res.ok || !json || !json.ok) {
            return { ok: false, error: (json && json.error) || ("HTTP " + res.status) };
          }
          return json;
        });
      })
      .catch(function (err) {
        return { ok: false, error: String((err && err.message) || err) };
      });
  }

  // Success state: confirm what's live and hand over the shareable link.
  function showPublished(panel, result) {
    panel.querySelectorAll(
      ".publish-stories__body, .publish-stories__actions, .publish-stories__lede"
    ).forEach(function (n) { n.remove(); });

    var n = result.count || 0;
    panel.appendChild(el(
      "p",
      "publish-stories__lede",
      n === 1 ? "1 pitch is now live on your profile." : n + " pitches are now live on your profile."
    ));

    var url = result.storiesUrl || "";
    if (url) {
      var linkRow = el("div", "publish-stories__linkrow");
      var link = el("a", "publish-stories__link", url);
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      linkRow.appendChild(link);

      var copy = el("button", "publish-stories__copy", "Copy link");
      copy.type = "button";
      copy.addEventListener("click", function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            copy.textContent = "Copied";
          }, function () { /* leave the visible URL */ });
        }
      });
      linkRow.appendChild(copy);
      panel.appendChild(linkRow);
      panel.appendChild(el(
        "p",
        "publish-stories__note",
        "Share this link with anyone — they can read your stories without signing in."
      ));
    }
  }

  function init() {
    var btn = document.getElementById("nav-publish-stories");
    if (!btn) return;
    btn.addEventListener("click", open);
  }

  window.tinkerPublishStories = { open: open, close: close };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
