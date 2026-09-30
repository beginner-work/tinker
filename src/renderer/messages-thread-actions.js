/* Shared Keep crafting / This is everything action chrome.
 *
 * Lead notepad and the You (owner) thread must show the same order and
 * roles: secondary "Keep crafting" first, primary "This is everything"
 * second. Primary is the solid indigo pill; secondary is outlined.
 */
(function (root) {
  "use strict";

  var PRIMARY_LABEL = "This is everything";
  var SECONDARY_LABEL = "Keep crafting";

  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] === false || attrs[k] == null) return;
        n.setAttribute(k, attrs[k] === true ? "" : String(attrs[k]));
      });
    }
    return n;
  }

  /**
   * Build a footer with secondary then primary (lead/You order).
   * Optional tertiary (e.g. reading "Section done") after primary.
   * Returns { foot, primary, secondary, tertiary }.
   */
  function buildFoot(opts) {
    opts = opts || {};
    var foot = el("footer", opts.footClass || "messages-notepad__foot", {
      "data-thread-actions": "1",
    });
    var secondary = el("button", opts.secondaryClass || "messages-notepad__secondary", {
      type: "button",
      "data-thread-action": "secondary",
      "data-notepad-secondary": "1",
    });
    var primary = el("button", opts.primaryClass || "messages-notepad__primary", {
      type: "button",
      "data-thread-action": "primary",
      "data-notepad-primary": "1",
    });
    var tertiary = el("button", opts.tertiaryClass || "messages-notepad__tertiary", {
      type: "button",
      "data-thread-action": "tertiary",
      "data-notepad-tertiary": "1",
      hidden: "",
    });
    secondary.textContent = opts.secondaryLabel != null ? opts.secondaryLabel : SECONDARY_LABEL;
    primary.textContent = opts.primaryLabel != null ? opts.primaryLabel : PRIMARY_LABEL;
    tertiary.textContent = opts.tertiaryLabel != null ? opts.tertiaryLabel : "";
    // Order: Keep crafting, This is everything, optional Section done.
    foot.appendChild(secondary);
    foot.appendChild(primary);
    foot.appendChild(tertiary);
    if (typeof opts.onSecondary === "function") {
      secondary.addEventListener("click", function () { opts.onSecondary(); });
    }
    if (typeof opts.onPrimary === "function") {
      primary.addEventListener("click", function () { opts.onPrimary(); });
    }
    if (typeof opts.onTertiary === "function") {
      tertiary.addEventListener("click", function () { opts.onTertiary(); });
    }
    return { foot: foot, primary: primary, secondary: secondary, tertiary: tertiary };
  }

  /** Ensure an existing writing footer matches lead order + labels in You mode. */
  function syncWritingFoot(foot, endBtn, nextBtn) {
    if (!foot || !endBtn || !nextBtn) return;
    // DOM order: Keep crafting (next), then This is everything (end).
    if (nextBtn.nextSibling !== endBtn) {
      foot.insertBefore(nextBtn, endBtn);
    }
    if (document.body.classList.contains("messages-you-active")) {
      nextBtn.textContent = SECONDARY_LABEL;
      endBtn.textContent = PRIMARY_LABEL;
    }
  }

  root.tinkerThreadActions = {
    PRIMARY_LABEL: PRIMARY_LABEL,
    SECONDARY_LABEL: SECONDARY_LABEL,
    buildFoot: buildFoot,
    syncWritingFoot: syncWritingFoot,
  };
})(typeof window !== "undefined" ? window : globalThis);
