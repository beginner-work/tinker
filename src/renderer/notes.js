/* notes.js — full-screen notes surface (TYL-49).
 *
 * Writing is the primary surface: brand, one typing area, save on this
 * device. Notes live as local files via notes-files.js (OPFS, with a
 * localStorage fallback). No server calls. No cards in the editor.
 *
 * Sidebar → Notes. Escape or the close control returns to the previous
 * surface the same way LinkedIn draft does.
 */

(function () {
  "use strict";

  if (typeof document === "undefined") return;

  var store = null;
  var overlay = null;
  var concealed = [];
  var saveTimer = null;
  var activeId = null;

  function files() {
    if (store) return store;
    var api = window.tinkerNotesFiles;
    if (!api) throw new Error("notes-files.js must load before notes.js");
    store = api;
    return store;
  }

  function el(tag, className, attrs) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        node.setAttribute(k, attrs[k]);
      });
    }
    return node;
  }

  function closeIcon() {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M6 6l12 12M18 6L6 18");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    svg.appendChild(path);
    return svg;
  }

  function surfaceSnapshot(node) {
    return {
      node: node,
      display: node.style.display,
      pointerEvents: node.style.pointerEvents,
      hidden: !!node.hidden,
      active: node.hasAttribute("data-active"),
      inert: node.hasAttribute("inert"),
      ariaHidden: node.getAttribute("aria-hidden"),
    };
  }

  function concealNode(node) {
    if (node.hasAttribute("data-active")) node.removeAttribute("data-active");
    node.hidden = true;
    node.setAttribute("inert", "");
    node.setAttribute("aria-hidden", "true");
    node.style.display = "none";
    node.style.pointerEvents = "none";
  }

  function concealSurfaces() {
    var saved = [];
    var stage = document.getElementById("stage");
    if (stage) {
      for (var i = 0; i < stage.children.length; i++) {
        var child = stage.children[i];
        if (child.getAttribute("aria-label") === "Notes") continue;
        saved.push(surfaceSnapshot(child));
        concealNode(child);
      }
    }
    var modeNav = document.getElementById("mode-nav");
    if (modeNav) {
      saved.push(surfaceSnapshot(modeNav));
      concealNode(modeNav);
    }
    return saved;
  }

  function restoreSurfaces(saved) {
    for (var i = 0; i < saved.length; i++) {
      var item = saved[i];
      var node = item.node;
      node.style.display = item.display;
      node.style.pointerEvents = item.pointerEvents;
      node.hidden = item.hidden;
      if (item.inert) node.setAttribute("inert", "");
      else node.removeAttribute("inert");
      if (item.ariaHidden == null) node.removeAttribute("aria-hidden");
      else node.setAttribute("aria-hidden", item.ariaHidden);
      if (item.active) node.setAttribute("data-active", "");
      else node.removeAttribute("data-active");
    }
  }

  function close() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (concealed.length) {
      restoreSurfaces(concealed);
      concealed = [];
    }
    if (!overlay) return;
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
    overlay = null;
    activeId = null;
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }

  function formatWhen(ms) {
    try {
      return new Date(ms).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch (e) {
      return "";
    }
  }

  function setStatus(node, text) {
    if (!node) return;
    node.textContent = text || "";
  }

  async function renderList(mount, statusEl) {
    mount.innerHTML = "";
    mount.className = "notes-shell notes-shell--list";

    var brand = el("p", "notes-brand");
    brand.textContent = "tinker";
    var heading = el("h1", "notes-heading");
    heading.textContent = "Notes";
    var lede = el("p", "notes-lede");
    lede.textContent = "Write here. Files stay on this device.";

    var actions = el("div", "notes-actions");
    var newBtn = el("button", "notes-primary", { type: "button" });
    newBtn.textContent = "New note";
    newBtn.addEventListener("click", function () {
      openEditor(null);
    });
    actions.appendChild(newBtn);

    mount.appendChild(brand);
    mount.appendChild(heading);
    mount.appendChild(lede);
    mount.appendChild(actions);

    var list = el("ul", "notes-list");
    mount.appendChild(list);

    var notes = [];
    try {
      notes = await files().list();
    } catch (e) {
      setStatus(statusEl, "Could not read notes on this device.");
      return;
    }

    if (!notes.length) {
      var empty = el("p", "notes-empty");
      empty.textContent = "No notes yet. Start a new one.";
      mount.appendChild(empty);
      setStatus(statusEl, "On this device");
      return;
    }

    notes.forEach(function (note) {
      var item = el("li", "notes-list__item");
      var btn = el("button", "notes-list__btn", {
        type: "button",
        "data-note-id": note.id,
      });
      var title = el("span", "notes-list__title");
      title.textContent = note.title || "Untitled";
      var meta = el("span", "notes-list__meta");
      meta.textContent = formatWhen(note.updatedAt);
      var preview = el("span", "notes-list__preview");
      preview.textContent = note.preview || "";
      btn.appendChild(title);
      btn.appendChild(meta);
      btn.appendChild(preview);
      btn.addEventListener("click", function () {
        openEditor(note.id);
      });
      item.appendChild(btn);
      list.appendChild(item);
    });
    setStatus(statusEl, notes.length + (notes.length === 1 ? " note" : " notes") + " on this device");
  }

  async function openEditor(id) {
    if (!overlay) return;
    var mount = overlay.querySelector("[data-notes-mount]");
    var statusEl = overlay.querySelector("[data-notes-status]");
    if (!mount) return;

    var note = null;
    try {
      if (id) {
        note = await files().get(id);
      }
      if (!note) {
        note = await files().create({ body: "" });
      }
    } catch (e) {
      setStatus(statusEl, "Could not open a note on this device.");
      return;
    }

    activeId = note.id;
    mount.innerHTML = "";
    mount.className = "notes-shell notes-shell--editor";

    var top = el("div", "notes-editor-top");
    var back = el("button", "notes-text-btn", { type: "button" });
    back.textContent = "All notes";
    back.addEventListener("click", function () {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      flushSave(ta, statusEl).then(function () {
        renderList(mount, statusEl);
      });
    });
    var brand = el("p", "notes-brand notes-brand--inline");
    brand.textContent = "tinker";
    top.appendChild(back);
    top.appendChild(brand);

    var ta = el("textarea", "notes-textarea", {
      "aria-label": "Note",
      spellcheck: "true",
      autocomplete: "off",
      autocorrect: "on",
      autocapitalize: "sentences",
    });
    ta.value = note.body || "";
    ta.placeholder = "Start typing…";

    var foot = el("div", "notes-editor-foot");
    var del = el("button", "notes-text-btn notes-text-btn--danger", { type: "button" });
    del.textContent = "Delete";
    del.addEventListener("click", async function () {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      try {
        await files().remove(note.id);
        activeId = null;
        await renderList(mount, statusEl);
      } catch (e) {
        setStatus(statusEl, "Could not delete this note.");
      }
    });
    foot.appendChild(del);

    mount.appendChild(top);
    mount.appendChild(ta);
    mount.appendChild(foot);

    setStatus(statusEl, "Saved on this device");

    ta.addEventListener("input", function () {
      setStatus(statusEl, "Saving…");
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        flushSave(ta, statusEl);
      }, 280);
    });

    setTimeout(function () {
      ta.focus();
      try {
        var len = ta.value.length;
        ta.setSelectionRange(len, len);
      } catch (e) {
        /* ignore */
      }
    }, 30);
  }

  async function flushSave(ta, statusEl) {
    if (!activeId || !ta) return null;
    try {
      var saved = await files().save({
        id: activeId,
        body: ta.value,
        syncState: "local",
      });
      setStatus(statusEl, "Saved on this device · " + formatWhen(saved.updatedAt));
      return saved;
    } catch (e) {
      setStatus(statusEl, "Could not save on this device.");
      return null;
    }
  }

  function open(opts) {
    close();
    var stage = document.getElementById("stage") || document.body;
    concealed = concealSurfaces();

    overlay = el("section", "writing notes-surface", {
      role: "region",
      "aria-label": "Notes",
    });

    var header = el("header", "writing__top");
    var closeBtn = el("button", "writing__close", {
      type: "button",
      "aria-label": "Close notes",
    });
    closeBtn.appendChild(closeIcon());
    closeBtn.addEventListener("click", close);
    var step = el("div", "writing__step");
    step.textContent = "Notes";
    var status = el("div", "notes-status", {
      role: "status",
      "aria-live": "polite",
      "data-notes-status": "",
    });
    header.appendChild(closeBtn);
    header.appendChild(step);
    header.appendChild(status);

    var body = el("div", "writing__body notes-body");
    var mount = el("div", "notes-shell", { "data-notes-mount": "" });
    body.appendChild(mount);

    overlay.appendChild(header);
    overlay.appendChild(body);
    stage.appendChild(overlay);
    document.addEventListener("keydown", onKeydown, true);

    var startId = opts && typeof opts.id === "string" ? opts.id : null;
    files()
      .ready()
      .then(function () {
        if (startId) return openEditor(startId);
        return files()
          .list()
          .then(function (notes) {
            if (!notes.length) return openEditor(null);
            return renderList(mount, status);
          });
      })
      .catch(function () {
        setStatus(status, "Notes storage is unavailable in this browser.");
      });
  }

  function bindNav() {
    var btn = document.getElementById("nav-notes");
    if (!btn || btn.dataset.notesBound) return;
    btn.dataset.notesBound = "1";
    btn.addEventListener("click", function () {
      open();
      if (typeof window.tinkerCloseDrawer === "function") {
        try {
          window.tinkerCloseDrawer();
        } catch (e) {
          /* ignore */
        }
      }
    });
  }

  window.tinkerNotes = {
    open: open,
    close: close,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindNav);
  } else {
    bindNav();
  }
})();
