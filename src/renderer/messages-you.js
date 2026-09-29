/* Pinned "You" row: open the guided assistant (writing interview) inside
 * the same messages chat layout. Ship / Next map to writing end / next.
 */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var host = null;
  var writing = null;
  var homeParent = null;
  var homeNext = null;
  var open = false;

  function pane() {
    return document.getElementById("messages-pane");
  }
  function ensureHosts() {
    writing = document.getElementById("writing");
    host = document.querySelector("#messages-pane [data-messages-thread]");
    if (writing && !homeParent) {
      homeParent = writing.parentNode;
      homeNext = writing.nextSibling;
    }
  }
  function ownerName() {
    try {
      var shell = window.tinkerMessagesShell;
      if (shell && shell.OWNER_LABEL) return shell.OWNER_LABEL;
      if (shell && typeof shell.ownerProfile === "function") {
        var p = shell.ownerProfile();
        if (p && p.name) return p.name;
      }
    } catch (e) { /* ignore */ }
    return "Lindow Labs";
  }
  function ownerLogo() {
    try {
      var shell = window.tinkerMessagesShell;
      if (shell && shell.OWNER_LOGO) return shell.OWNER_LOGO;
      if (shell && typeof shell.ownerProfile === "function") {
        var p = shell.ownerProfile();
        if (p && p.avatarUrl) return p.avatarUrl;
      }
    } catch (e) { /* ignore */ }
    return "./icons/lindow-labs.svg";
  }
  function ownerTitle() {
    try {
      var shell = window.tinkerMessagesShell;
      if (shell && typeof shell.ownerProfile === "function") {
        var p = shell.ownerProfile();
        if (p && p.title) return String(p.title).trim();
      }
    } catch (e) { /* ignore */ }
    return "";
  }
  function ownerLinkedIn() {
    try {
      var shell = window.tinkerMessagesShell;
      if (shell && typeof shell.ownerProfile === "function") {
        var p = shell.ownerProfile();
        if (p && p.linkedInUrl) return String(p.linkedInUrl).trim();
      }
    } catch (e) { /* ignore */ }
    return "";
  }
  function setHeader() {
    var p = pane();
    if (!p) return;
    var nameEl = p.querySelector("[data-messages-name]");
    var role = p.querySelector("[data-messages-role]");
    var avatar = p.querySelector("[data-messages-avatar]");
    var links = p.querySelector("[data-messages-links]");
    if (nameEl) nameEl.textContent = ownerName();
    var title = ownerTitle();
    if (role) {
      role.hidden = !title;
      role.textContent = title ? " · " + title : "";
    }
    // Owner links come only from the owner profile - never a leftover person URL.
    if (window.tinkerMessagesThread && typeof window.tinkerMessagesThread.renderProfileLinks === "function") {
      window.tinkerMessagesThread.renderProfileLinks({
        linkedInUrl: ownerLinkedIn(),
        githubUrl: "",
      });
    } else if (links) {
      links.hidden = true;
      links.innerHTML = "";
    }
    if (avatar) {
      avatar.hidden = false;
      avatar.innerHTML = "";
      var img = document.createElement("img");
      img.className = "messages-avatar__img";
      img.src = ownerLogo();
      img.alt = ownerName();
      avatar.appendChild(img);
      avatar.classList.add("messages-avatar--photo", "messages-avatar--brand");
    }
  }
  function token() {
    try { return localStorage.getItem("tinker_jwt") || ""; } catch (e) { return ""; }
  }
  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function formatWhen(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      if (!Number.isFinite(d.getTime())) return "";
      return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch (e) { return ""; }
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function inlineMarkdown(s) {
    var esc = escapeHtml(s);
    esc = esc.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    esc = esc.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    return esc;
  }
  function fillMarkdown(node, src) {
    node.innerHTML = "";
    var lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
    var list = null;
    function flushList() {
      if (list) { node.appendChild(list); list = null; }
    }
    lines.forEach(function (line) {
      var heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        flushList();
        var h = document.createElement("h" + (Number(heading[1].length) + 2));
        h.innerHTML = inlineMarkdown(heading[2]);
        node.appendChild(h);
        return;
      }
      if (/^[-*]\s+/.test(line)) {
        if (!list) list = document.createElement("ul");
        var li = document.createElement("li");
        li.innerHTML = inlineMarkdown(line.replace(/^[-*]\s+/, ""));
        list.appendChild(li);
        return;
      }
      if (!String(line).trim()) { flushList(); return; }
      flushList();
      var p = document.createElement("p");
      p.innerHTML = inlineMarkdown(line);
      node.appendChild(p);
    });
    flushList();
  }
  function renderSelfPosts(messages) {
    var list = el("ol", "messages-thread__list messages-thread__list--self", { "aria-label": "Assistant posts" });
    (messages || []).forEach(function (msg) {
      var li = el("li", "messages-thread__item messages-thread__item--lead messages-thread__item--assistant");
      var bubble = el("div", "messages-thread__bubble");
      if (msg.title) {
        var subj = el("div", "messages-thread__subject");
        subj.textContent = msg.title;
        bubble.appendChild(subj);
      }
      var body = el("div", "messages-thread__body messages-thread__body--markdown");
      fillMarkdown(body, msg.body || "");
      bubble.appendChild(body);
      var meta = el("div", "messages-thread__meta");
      meta.textContent = ["Assistant", formatWhen(msg.createdAt)].filter(Boolean).join(" · ");
      bubble.appendChild(meta);
      li.appendChild(bubble);
      list.appendChild(li);
    });
    return list;
  }
  function isPlanDumpTitle(title) {
    var t = String(title || "").trim().toLowerCase();
    if (!t) return false;
    if (t.indexOf("gtm approach") !== -1) return true;
    if (t.indexOf("go-to-market approach") !== -1) return true;
    if (t.indexOf("go to market approach") !== -1) return true;
    if (t.indexOf("your gtm") === 0) return true;
    if (t.indexOf("deploy check") !== -1 || t.indexOf("deploy status") !== -1) return true;
    if (t.indexOf("lead tools deploy") !== -1) return true;
    return false;
  }
  function loadSelfPosts() {
    var t = token();
    if (!t) return Promise.resolve([]);
    var headers = { Authorization: "Bearer " + t, Accept: "application/json" };
    // Hard-delete legacy GTM plan dumps before listing so the owner tab
    // never reopens on "Your GTM approach".
    return fetch("/api/self-thread?action=purge_plan", {
      method: "POST",
      headers: headers,
      body: "{}",
    }).catch(function () { return null; }).then(function () {
      return fetch("/api/self-thread?action=list", { headers: headers });
    }).then(function (res) { return res && res.ok ? res.json() : { messages: [] }; })
      .then(function (json) {
        var messages = Array.isArray(json.messages) ? json.messages : [];
        return messages.filter(function (msg) { return !isPlanDumpTitle(msg && msg.title); });
      })
      .catch(function () { return []; });
  }
  function labelFloatingActions() {
    var end = document.getElementById("writing-end");
    var next = document.getElementById("writing-next");
    if (end) end.textContent = "This is everything";
    // Don't rename the scene-setting Continue control; only interview Next.
    if (next) {
      var label = String(next.textContent || "").trim();
      if (label === "Continue →" || /^Continue/i.test(label)) return;
      next.textContent = "Keep crafting";
    }
  }
  function focusNotepad() {
    if (!writing) return;
    var ta = writing.querySelector(".writing-input");
    if (!ta) return;
    try {
      ta.focus({ preventScroll: true });
      var len = (ta.value || "").length;
      // Empty notepad: caret at the top. Existing text: leave selection alone.
      if (!len && typeof ta.setSelectionRange === "function") ta.setSelectionRange(0, 0);
    } catch (e) { /* ignore */ }
  }
  function mountWriting(messages) {
    ensureHosts();
    if (!writing || !host) return;
    var empty = document.querySelector("#messages-pane [data-messages-empty]");
    if (empty) empty.hidden = true;
    host.hidden = false;
    host.setAttribute("data-thread-ready", "1");
    host.classList.add("messages-thread", "messages-thread--you");
    if (writing.parentNode) writing.parentNode.removeChild(writing);
    host.innerHTML = "";
    if (messages && messages.length) host.appendChild(renderSelfPosts(messages));
    host.appendChild(writing);
    writing.hidden = false;
    writing.classList.add("writing--in-messages");
    document.body.classList.add("messages-you-active");
    setHeader();
    labelFloatingActions();
    var composer = document.getElementById("messages-composer");
    if (composer) composer.hidden = true;
  }
  function unmountWriting() {
    ensureHosts();
    if (!writing || !homeParent) return;
    writing.classList.remove("writing--in-messages");
    writing.hidden = true;
    if (homeNext) homeParent.insertBefore(writing, homeNext);
    else homeParent.appendChild(writing);
    document.body.classList.remove("messages-you-active");
  }
  function startSession() {
    try {
      if (typeof window.tinkerResumeDraft === "function") {
        var raw = null;
        try { raw = localStorage.getItem("tinker.drafts.v1"); } catch (e) { raw = null; }
        var list = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list) && list.length && list[0] && list[0].id) {
          window.tinkerResumeDraft(list[0].id);
          return;
        }
      }
    } catch (e) { /* fall through */ }
    if (typeof window.tinkerNewSession === "function") {
      window.tinkerNewSession();
    }
  }
  function clickWriting(id) {
    var btn = document.getElementById(id);
    if (btn && !btn.disabled) btn.click();
  }
  function onYouAction(e) {
    if (!open) return;
    var action = e && e.detail && e.detail.action;
    if (action === "ship") clickWriting("writing-end");
    else if (action === "next") clickWriting("writing-next");
  }
  function openYou() {
    ensureHosts();
    open = true;
    mountWriting([]);
    startSession();
    loadSelfPosts().then(function (messages) {
      if (!open) return;
      mountWriting(messages);
      labelFloatingActions();
      focusNotepad();
    });
    setTimeout(labelFloatingActions, 80);
    setTimeout(focusNotepad, 120);
    setTimeout(focusNotepad, 400);
  }
  function closeYou() {
    if (!open) return;
    open = false;
    unmountWriting();
  }

  window.tinkerMessagesYou = {
    open: openYou,
    close: closeYou,
    isOpen: function () { return open; },
  };

  window.addEventListener("tinker:messages-you-action", onYouAction);

  function boot() {
    ensureHosts();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
