/* Shared invisible notepad for You and lead person threads.
 * Borderless page typing + floating bottom-center pill actions.
 * You: Keep crafting / This is everything.
 * Leads: Save draft (no Send).
 */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var root = null;
  var opts = {
    primaryLabel: "Save draft",
    secondaryLabel: "",
    onPrimary: null,
    onSecondary: null,
    onInput: null,
    heading: "",
    metaHtml: null,
  };

  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  function ensure() {
    if (root) return root;
    root = el("div", "messages-notepad", { "data-messages-notepad": "1", hidden: "" });
    var body = el("div", "messages-notepad__body");
    var card = el("div", "messages-notepad__card");
    var heading = el("div", "messages-notepad__heading", { "data-notepad-heading": "1", hidden: "" });
    var meta = el("div", "messages-notepad__meta", { "data-notepad-meta": "1", hidden: "" });
    var input = el("textarea", "messages-notepad__input", {
      "data-notepad-input": "1",
      rows: "12",
      spellcheck: "true",
    });
    input.setAttribute("aria-label", "Draft");
    card.appendChild(heading);
    card.appendChild(meta);
    card.appendChild(input);
    body.appendChild(card);
    var actions = window.tinkerThreadActions;
    var built = actions && typeof actions.buildFoot === "function"
      ? actions.buildFoot({
          footClass: "messages-notepad__foot",
          primaryLabel: "Save draft",
          secondaryLabel: "",
          onPrimary: function () {
            if (typeof opts.onPrimary === "function") opts.onPrimary();
          },
          onSecondary: function () {
            if (typeof opts.onSecondary === "function") opts.onSecondary();
          },
        })
      : null;
    var foot;
    var primary;
    var secondary;
    if (built) {
      foot = built.foot;
      foot.setAttribute("data-notepad-foot", "1");
      primary = built.primary;
      secondary = built.secondary;
      secondary.hidden = true;
    } else {
      foot = el("footer", "messages-notepad__foot", { "data-notepad-foot": "1" });
      secondary = el("button", "messages-notepad__secondary", {
        type: "button",
        "data-notepad-secondary": "1",
        hidden: "",
      });
      primary = el("button", "messages-notepad__primary", {
        type: "button",
        "data-notepad-primary": "1",
      });
      primary.textContent = "Save draft";
      foot.appendChild(secondary);
      foot.appendChild(primary);
      primary.addEventListener("click", function () {
        if (typeof opts.onPrimary === "function") opts.onPrimary();
      });
      secondary.addEventListener("click", function () {
        if (typeof opts.onSecondary === "function") opts.onSecondary();
      });
    }
    root.appendChild(body);
    root.appendChild(foot);
    input.addEventListener("input", function () {
      if (typeof opts.onInput === "function") opts.onInput(input.value);
    });
    return root;
  }

  function applyLabels() {
    var primary = root && root.querySelector("[data-notepad-primary]");
    var secondary = root && root.querySelector("[data-notepad-secondary]");
    if (primary) {
      var primaryLabel = String(opts.primaryLabel || "").trim();
      if (!primaryLabel && opts.hideFoot) {
        primary.hidden = true;
        primary.textContent = "";
      } else {
        primary.hidden = false;
        primary.textContent = primaryLabel || "Save draft";
      }
    }
    if (secondary) {
      var label = String(opts.secondaryLabel || "").trim();
      secondary.hidden = !label;
      secondary.textContent = label;
    }
  }

  function applyHeading() {
    var heading = root && root.querySelector("[data-notepad-heading]");
    if (!heading) return;
    var text = String(opts.heading || "").trim();
    heading.hidden = !text;
    heading.textContent = text;
  }

  function applyMeta() {
    var meta = root && root.querySelector("[data-notepad-meta]");
    if (!meta) return;
    meta.innerHTML = "";
    if (opts.metaNode) {
      meta.hidden = false;
      meta.appendChild(opts.metaNode);
      return;
    }
    meta.hidden = true;
  }

  function applyChrome() {
    var input = root && root.querySelector("[data-notepad-input]");
    var foot = root && root.querySelector("[data-notepad-foot]");
    if (input) {
      input.hidden = !!opts.hideInput;
      if (opts.hideInput) input.value = "";
    }
    if (foot) foot.hidden = !!opts.hideFoot;
  }

  function mount(host, nextOpts) {
    ensure();
    opts = Object.assign({}, opts, nextOpts || {});
    if (!host) return root;
    if (root.parentNode !== host) {
      if (root.parentNode) root.parentNode.removeChild(root);
      host.appendChild(root);
    }
    root.hidden = false;
    document.body.classList.add("messages-notepad-active");
    applyLabels();
    applyHeading();
    applyMeta();
    applyChrome();
    if (!opts.hideInput && Object.prototype.hasOwnProperty.call(opts, "value")) {
      var input = root.querySelector("[data-notepad-input]");
      if (input && document.activeElement !== input) input.value = opts.value || "";
    }
    return root;
  }

  function unmount() {
    if (!root) return;
    root.hidden = true;
    if (root.parentNode) root.parentNode.removeChild(root);
    document.body.classList.remove("messages-notepad-active");
  }

  function focus() {
    var input = root && root.querySelector("[data-notepad-input]");
    if (!input) return;
    try {
      input.focus({ preventScroll: true });
      var len = (input.value || "").length;
      if (!len && typeof input.setSelectionRange === "function") input.setSelectionRange(0, 0);
    } catch (e) { /* ignore */ }
  }

  function getValue() {
    var input = root && root.querySelector("[data-notepad-input]");
    return input ? input.value : "";
  }

  function setValue(value) {
    var input = root && root.querySelector("[data-notepad-input]");
    if (!input) return;
    input.value = value || "";
  }

  function setPrimaryEnabled(on) {
    var primary = root && root.querySelector("[data-notepad-primary]");
    if (primary) primary.disabled = !on;
  }

  function isMounted() {
    return !!(root && root.parentNode && !root.hidden);
  }

  window.tinkerMessagesNotepad = {
    mount: mount,
    unmount: unmount,
    focus: focus,
    getValue: getValue,
    setValue: setValue,
    setPrimaryEnabled: setPrimaryEnabled,
    isMounted: isMounted,
    el: function () { return ensure(); },
  };
})();
