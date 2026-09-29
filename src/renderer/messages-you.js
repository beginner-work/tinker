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
  function setHeader() {
    var p = pane();
    if (!p) return;
    var nameEl = p.querySelector("[data-messages-name]");
    var role = p.querySelector("[data-messages-role]");
    var avatar = p.querySelector("[data-messages-avatar]");
    if (nameEl) nameEl.textContent = ownerName();
    if (role) {
      role.hidden = true;
      role.textContent = "";
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
    return t.indexOf("gtm approach") !== -1
      || t.indexOf("go-to-market approach") !== -1
      || t.indexOf("go to market approach") !== -1
      || t.indexOf("your gtm") === 0;
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
    var composer = document.getElementById("messages-composer");
    if (composer) composer.hidden = false;
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
  function syncComposerFromWriting() {
    if (!open || !writing) return;
    var ta = writing.querySelector(".writing-input");
    var body = document.querySelector("#messages-composer [data-composer-body]");
    if (!ta || !body) return;
    if (document.activeElement === body) return;
    body.value = ta.value || "";
    body.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function bindComposerBridge() {
    var body = document.querySelector("#messages-composer [data-composer-body]");
    if (!body || body.getAttribute("data-you-bridge")) return;
    body.setAttribute("data-you-bridge", "1");
    body.addEventListener("input", function () {
      if (!open || !writing) return;
      var ta = writing.querySelector(".writing-input");
      if (!ta) return;
      ta.value = body.value;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  function openYou() {
    ensureHosts();
    open = true;
    mountWriting([]);
    bindComposerBridge();
    startSession();
    loadSelfPosts().then(function (messages) {
      if (!open) return;
      mountWriting(messages);
    });
    setTimeout(syncComposerFromWriting, 80);
    setTimeout(syncComposerFromWriting, 400);
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
