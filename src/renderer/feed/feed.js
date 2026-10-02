/* /feed — private, read-only mobile essay feed.
 *
 * Same sign-in as the rest of tinker: localStorage.tinker_jwt.
 * Essays come from GET /api/essay-feed?action=list (server filters
 * tests / empty drafts / [object Object]). Stars persist server-side.
 * Play is hidden until the API reports audioEnabled.
 */

(function () {
  "use strict";

  var TOKEN_KEY = "tinker_jwt";
  var RETURN_KEY = "tinker_mcp_return";

  var scroller = document.getElementById("feed-scroller");
  var emptyEl = document.getElementById("feed-empty");
  var statusEl = document.getElementById("feed-status");
  var desktopNote = document.getElementById("feed-desktop-note");
  var filterButtons = document.querySelectorAll(".feed-filter");

  var state = {
    items: [],
    filter: "all",
    audioEnabled: false,
    audio: null,
    playingId: null,
  };

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (err) { return ""; }
  }

  function sendHome() {
    try { sessionStorage.setItem(RETURN_KEY, "/feed"); }
    catch (err) { /* sign-in still works without return */ }
    window.location.assign("/");
  }

  if (!token()) {
    sendHome();
    return;
  }

  if (desktopNote && window.matchMedia && window.matchMedia("(min-width: 900px)").matches) {
    desktopNote.hidden = false;
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || "";
  }

  function authHeaders(json) {
    var headers = { Authorization: "Bearer " + token() };
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }

  function readJson(res) {
    return res.json().then(function (body) {
      return { status: res.status, body: body };
    }, function () {
      return { status: res.status, body: null };
    });
  }

  function handleAuth(result) {
    if (result.status === 401) {
      try { localStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignore */ }
      sendHome();
      return true;
    }
    return false;
  }

  function formatDate(ms) {
    var n = Number(ms) || 0;
    if (!n) return "";
    try {
      return new Date(n).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (err) {
      return "";
    }
  }

  function paragraphsHtml(body) {
    var text = String(body || "");
    var parts = text.split(/\n{2,}/);
    var html = "";
    for (var i = 0; i < parts.length; i++) {
      var esc = document.createElement("div");
      esc.textContent = parts[i];
      html += "<p>" + esc.innerHTML.replace(/\n/g, "<br>") + "</p>";
    }
    return html || "<p></p>";
  }

  function visibleItems() {
    if (state.filter === "starred") {
      return state.items.filter(function (item) { return item.starred; });
    }
    return state.items;
  }

  function render() {
    var items = visibleItems();
    scroller.innerHTML = "";

    if (!items.length) {
      emptyEl.hidden = false;
      emptyEl.textContent = state.filter === "starred"
        ? "No starred essays yet."
        : "No essays yet.";
      return;
    }
    emptyEl.hidden = true;

    for (var i = 0; i < items.length; i++) {
      scroller.appendChild(renderCard(items[i]));
    }
  }

  function renderCard(item) {
    var card = document.createElement("article");
    card.className = "feed-card";
    card.dataset.essayId = item.id;

    var headline = document.createElement("h1");
    headline.className = "feed-card__headline";
    headline.textContent = item.headline || "Untitled";
    card.appendChild(headline);

    var meta = document.createElement("div");
    meta.className = "feed-card__meta";

    var date = document.createElement("p");
    date.className = "feed-card__date";
    date.textContent = formatDate(item.createdAt);
    meta.appendChild(date);

    var actions = document.createElement("div");
    actions.className = "feed-card__actions";

    var starBtn = document.createElement("button");
    starBtn.type = "button";
    starBtn.className = "feed-card__btn" + (item.starred ? " is-starred" : "");
    starBtn.setAttribute("aria-label", item.starred ? "Unstar essay" : "Star essay");
    starBtn.setAttribute("aria-pressed", item.starred ? "true" : "false");
    starBtn.textContent = item.starred ? "★" : "☆";
    starBtn.addEventListener("click", function () {
      toggleStar(item, starBtn);
    });
    actions.appendChild(starBtn);

    var playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "feed-card__btn feed-card__play";
    playBtn.setAttribute("aria-label", "Play essay");
    playBtn.textContent = "▶";
    playBtn.hidden = !state.audioEnabled;
    playBtn.addEventListener("click", function () {
      playEssay(item, playBtn);
    });
    actions.appendChild(playBtn);

    meta.appendChild(actions);
    card.appendChild(meta);

    var body = document.createElement("div");
    body.className = "feed-card__body";
    body.innerHTML = paragraphsHtml(item.body);
    card.appendChild(body);

    return card;
  }

  function toggleStar(item, btn) {
    var next = !item.starred;
    btn.disabled = true;
    fetch("/api/essay-feed?action=star", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ essayId: item.id, starred: next }),
    }).then(readJson).then(function (result) {
      btn.disabled = false;
      if (handleAuth(result)) return;
      if (result.status !== 200) {
        setStatus((result.body && result.body.error) || "Could not star");
        return;
      }
      item.starred = !!(result.body && result.body.starred);
      btn.classList.toggle("is-starred", item.starred);
      btn.setAttribute("aria-pressed", item.starred ? "true" : "false");
      btn.setAttribute("aria-label", item.starred ? "Unstar essay" : "Star essay");
      btn.textContent = item.starred ? "★" : "☆";
      if (state.filter === "starred" && !item.starred) render();
    }).catch(function () {
      btn.disabled = false;
      setStatus("Could not star");
    });
  }

  function stopAudio() {
    if (state.audio) {
      try { state.audio.pause(); } catch (err) { /* ignore */ }
      try {
        if (state.audio.src && state.audio.src.indexOf("blob:") === 0) {
          URL.revokeObjectURL(state.audio.src);
        }
      } catch (err) { /* ignore */ }
      state.audio = null;
    }
    state.playingId = null;
    var buttons = scroller.querySelectorAll(".feed-card__play");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].textContent = "▶";
      buttons[i].disabled = false;
    }
  }

  function playEssay(item, btn) {
    if (!state.audioEnabled) return;

    if (state.playingId === item.id && state.audio && !state.audio.paused) {
      stopAudio();
      return;
    }

    stopAudio();
    btn.disabled = true;
    btn.textContent = "…";
    setStatus("");

    fetch("/api/essay-feed?action=audio", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ essayId: item.id }),
    }).then(readJson).then(function (result) {
      if (handleAuth(result)) return;
      if (result.status !== 200 || !result.body || !result.body.audioBase64) {
        btn.disabled = false;
        btn.textContent = "▶";
        setStatus((result.body && result.body.error) || "Playback unavailable");
        return;
      }

      var binary = atob(result.body.audioBase64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var blob = new Blob([bytes], { type: result.body.contentType || "audio/mpeg" });
      var url = URL.createObjectURL(blob);
      var audio = new Audio(url);
      state.audio = audio;
      state.playingId = item.id;
      btn.disabled = false;
      btn.textContent = "■";
      audio.addEventListener("ended", function () {
        stopAudio();
      });
      audio.play().catch(function () {
        setStatus("Could not play audio");
        stopAudio();
      });
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = "▶";
      setStatus("Playback unavailable");
    });
  }

  function setFilter(name) {
    state.filter = name === "starred" ? "starred" : "all";
    for (var i = 0; i < filterButtons.length; i++) {
      var btn = filterButtons[i];
      var active = btn.getAttribute("data-filter") === state.filter;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    }
    render();
  }

  for (var f = 0; f < filterButtons.length; f++) {
    filterButtons[f].addEventListener("click", function (ev) {
      setFilter(ev.currentTarget.getAttribute("data-filter"));
    });
  }

  setStatus("Loading…");
  fetch("/api/essay-feed?action=list", {
    method: "GET",
    headers: authHeaders(false),
  }).then(readJson).then(function (result) {
    if (handleAuth(result)) return;
    if (result.status !== 200 || !result.body) {
      setStatus((result.body && result.body.error) || "Could not load feed");
      emptyEl.hidden = false;
      return;
    }
    state.items = Array.isArray(result.body.items) ? result.body.items : [];
    state.audioEnabled = !!result.body.audioEnabled;
    setStatus(state.items.length ? "" : "");
    render();
  }).catch(function () {
    setStatus("Could not load feed");
    emptyEl.hidden = false;
  });
})();
