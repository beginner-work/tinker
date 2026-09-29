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
      if (shell && typeof shell.ownerProfile === "function") {
        var p = shell.ownerProfile();
        if (p && p.name) return p.name;
      }
    } catch (e) { /* ignore */ }
    return "You";
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
    if (avatar && window.tinkerMessagesShell && typeof window.tinkerMessagesShell.ownerProfile === "function") {
      var profile = window.tinkerMessagesShell.ownerProfile();
      avatar.hidden = false;
      avatar.innerHTML = "";
      if (profile && profile.avatarUrl) {
        var img = document.createElement("img");
        img.className = "messages-avatar__img";
        img.src = profile.avatarUrl;
        img.alt = profile.name || "";
        avatar.appendChild(img);
        avatar.classList.add("messages-avatar--photo");
      } else {
        avatar.classList.remove("messages-avatar--photo");
        avatar.textContent = (profile && profile.initials) || "Y";
      }
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
      body.textContent = msg.body || "";
      bubble.appendChild(body);
      var meta = el("div", "messages-thread__meta");
      meta.textContent = ["Assistant", formatWhen(msg.createdAt)].filter(Boolean).join(" · ");
      bubble.appendChild(meta);
      li.appendChild(bubble);
      list.appendChild(li);
    });
    return list;
  }
  function loadSelfPosts() {
    var t = token();
    if (!t) return Promise.resolve([]);
    return fetch("/api/self-thread?action=list", {
      headers: { Authorization: "Bearer " + t, Accept: "application/json" },
    }).then(function (res) { return res.ok ? res.json() : { messages: [] }; })
      .then(function (json) { return Array.isArray(json.messages) ? json.messages : []; })
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
