/* Interview decks: read-only list and transcript view.
 *
 * Sidebar, Interview decks. Reuses .writing, .writing-card, and the
 * pill footer. No private stylesheet. Loads from /api/interview-decks
 * with the Stytch session already in localStorage (tinker_jwt). Decks
 * are saved by the MCP tool save_interview_deck. This panel does not
 * edit or delete.
 */
(function () {
  "use strict";

  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  var overlay = null;
  var concealed = [];

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (e) { return ""; }
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
        if (child.getAttribute("aria-label") === "Interview decks") continue;
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
    if (concealed.length) {
      restoreSurfaces(concealed);
      concealed = [];
    }
    if (!overlay) return;
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
    overlay = null;
  }

  function onKeydown(e) {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
  }

  function el(tag, className, attrs) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, attrs[k]);
      }
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

  function apiGet(id) {
    var bearer = token();
    var url = "/api/interview-decks";
    if (id) url += "?id=" + encodeURIComponent(id);
    return fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: bearer ? "Bearer " + bearer : "",
      },
    }).then(function (res) {
      return res.json().then(function (json) {
        return { status: res.status, ok: res.ok, json: json };
      }).catch(function () {
        return { status: res.status, ok: res.ok, json: null };
      });
    });
  }

  function formatWhen(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    try {
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch (e) {
      return d.toISOString();
    }
  }

  function open() {
    close();
    var stage = document.getElementById("stage") || document.body;

    overlay = el("section", "writing", {
      role: "region",
      "aria-label": "Interview decks",
    });

    var header = el("header", "writing__top");
    var closeBtn = el("button", "writing__close", {
      type: "button",
      "aria-label": "Close",
    });
    closeBtn.appendChild(closeIcon());
    closeBtn.addEventListener("click", close);
    var step = el("div", "writing__step");
    step.textContent = "Interview decks";
    header.appendChild(closeBtn);
    header.appendChild(step);

    var body = el("div", "writing__body");
    var column = el("div", "writing__stage");
    var listCard = el("div", "writing-card");
    var detailCard = el("div", "writing-card");
    detailCard.hidden = true;

    var title = el("h2", "writing-question");
    title.textContent = "Saved interviews";
    var sub = el("p", "writing-note");
    sub.textContent = "Finished ask_followups interviews land here. Open one to read the transcript. Read-only.";

    var statusWrap = el("div");
    var status = el("p", "writing-note", { role: "status", "aria-live": "polite" });
    statusWrap.hidden = true;
    statusWrap.appendChild(status);

    var listEl = el("div", "writing-note");
    listEl.setAttribute("data-deck-list", "1");

    listCard.appendChild(title);
    listCard.appendChild(sub);
    listCard.appendChild(statusWrap);
    listCard.appendChild(listEl);

    var detailTitle = el("h2", "writing-question");
    var detailMeta = el("p", "writing-note");
    var detailBody = el("div", "writing-note");
    detailBody.setAttribute("data-deck-detail", "1");
    detailCard.appendChild(detailTitle);
    detailCard.appendChild(detailMeta);
    detailCard.appendChild(detailBody);

    column.appendChild(listCard);
    column.appendChild(detailCard);
    body.appendChild(column);

    var foot = el("footer", "writing__foot");
    var backBtn = el("button", "writing__end", { type: "button" });
    backBtn.textContent = "All decks";
    backBtn.hidden = true;
    var doneBtn = el("button", "writing__next", { type: "button" });
    doneBtn.textContent = "Done";
    foot.appendChild(backBtn);
    foot.appendChild(doneBtn);

    function showStatus(text, kind) {
      status.textContent = text;
      if (kind === "error") {
        status.className = "writing-error";
        statusWrap.className = "writing-card writing-card--error";
      } else {
        status.className = "writing-note";
        statusWrap.className = "";
      }
      statusWrap.hidden = !text;
    }

    function hideStatus() {
      statusWrap.hidden = true;
      status.textContent = "";
    }

    function showList() {
      listCard.hidden = false;
      detailCard.hidden = true;
      backBtn.hidden = true;
    }

    function renderList(decks) {
      listEl.textContent = "";
      if (!decks || !decks.length) {
        var empty = el("p", "writing-note");
        empty.textContent = "No saved interviews yet. When a connector finishes ask_followups, it can call save_interview_deck.";
        listEl.appendChild(empty);
        return;
      }
      for (var i = 0; i < decks.length; i++) {
        (function (deck) {
          var row = el("button", "writing__end", { type: "button" });
          row.style.display = "block";
          row.style.width = "100%";
          row.style.textAlign = "left";
          row.style.marginBottom = "8px";
          var turns = typeof deck.turnCount === "number" ? deck.turnCount : 0;
          row.textContent = (deck.topic || "Untitled") + " · " + turns + " turn" + (turns === 1 ? "" : "s")
            + (deck.updatedAt ? " · " + formatWhen(deck.updatedAt) : "");
          row.addEventListener("click", function () { openDeck(deck.id); });
          listEl.appendChild(row);
        })(decks[i]);
      }
    }

    function renderDetail(deck) {
      detailTitle.textContent = deck.topic || "Untitled";
      detailMeta.textContent = formatWhen(deck.updatedAt) || "";
      detailBody.textContent = "";
      var turns = Array.isArray(deck.transcript) ? deck.transcript : [];
      if (!turns.length) {
        var empty = el("p", "writing-note");
        empty.textContent = "No turns in this transcript.";
        detailBody.appendChild(empty);
      } else {
        for (var i = 0; i < turns.length; i++) {
          var turn = turns[i] || {};
          var q = el("p", "writing-question");
          q.textContent = turn.q || "";
          var a = el("p", "writing-note");
          a.textContent = turn.a || "";
          detailBody.appendChild(q);
          detailBody.appendChild(a);
        }
      }
      listCard.hidden = true;
      detailCard.hidden = false;
      backBtn.hidden = false;
    }

    function openDeck(id) {
      hideStatus();
      apiGet(id).then(function (r) {
        if (r.status === 401) {
          try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignore */ }
          showStatus("Session expired. Sign in again.", "error");
          if (window.tinkerAuth && typeof window.tinkerAuth.showGate === "function") window.tinkerAuth.showGate();
          return;
        }
        if (r.status === 404 || !r.ok || !r.json || !r.json.deck) {
          showStatus((r.json && r.json.error) || "No deck with that id.", "error");
          showList();
          return;
        }
        renderDetail(r.json.deck);
      }).catch(function (err) {
        showStatus(err.message || "Couldn’t load that deck.", "error");
      });
    }

    backBtn.addEventListener("click", function () {
      hideStatus();
      showList();
    });
    doneBtn.addEventListener("click", close);

    overlay.appendChild(header);
    overlay.appendChild(body);
    overlay.appendChild(foot);
    stage.appendChild(overlay);
    concealed = concealSurfaces();
    document.addEventListener("keydown", onKeydown, true);

    if (!token()) {
      showStatus("Sign in to see your interview decks.", "error");
      renderList([]);
      return;
    }

    showStatus("Loading…", "ok");
    var mine = overlay;
    apiGet().then(function (r) {
      if (overlay !== mine) return;
      if (r.status === 401) {
        try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignore */ }
        showStatus("Session expired. Sign in again.", "error");
        if (window.tinkerAuth && typeof window.tinkerAuth.showGate === "function") window.tinkerAuth.showGate();
        renderList([]);
        return;
      }
      if (!r.ok) {
        showStatus((r.json && r.json.error) || "Couldn’t load decks.", "error");
        renderList([]);
        return;
      }
      hideStatus();
      renderList((r.json && r.json.decks) || []);
    }).catch(function (err) {
      if (overlay !== mine) return;
      showStatus(err.message || "Couldn’t load decks.", "error");
      renderList([]);
    });
  }

  function bind() {
    var btn = document.getElementById("nav-interview-decks");
    if (btn && btn.dataset.bound !== "1") {
      btn.dataset.bound = "1";
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        open();
      });
    }
    var sidebar = document.getElementById("sidebar");
    if (sidebar && sidebar.dataset.interviewDecksBound !== "1") {
      sidebar.dataset.interviewDecksBound = "1";
      sidebar.addEventListener("click", function (e) {
        if (!e.target.closest) return;
        if (e.target.closest("#nav-interview-decks")) return;
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.tinkerInterviewDecks = { open: open, close: close };
})();
