/* tinker — postings
 *
 * A tiny self-contained microblog on the welcome page. Posts live in
 * localStorage under a single key; the list re-renders from state on
 * every change. No backend, no users, no remote sync — just a place
 * to leave a note for yourself.
 */

(() => {
  "use strict";

  const STORAGE_KEY = "tinker.postings.v1";
  const MAX_LENGTH = 500;

  const form = document.getElementById("postings-form");
  const input = document.getElementById("postings-input");
  const submit = document.getElementById("postings-submit");
  const list = document.getElementById("postings-list");
  const empty = document.getElementById("postings-empty");
  const count = document.getElementById("postings-count");
  const remaining = document.getElementById("postings-remaining");

  if (!form || !input || !list) return;

  /** @type {Array<{id: string, text: string, createdAt: number}>} */
  let postings = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (p) => p && typeof p.id === "string" && typeof p.text === "string"
      );
    } catch {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(postings));
    } catch {
      // Quota exceeded or storage unavailable — silently drop.
    }
  }

  function uid() {
    return "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function relativeTime(ts) {
    const diffSec = Math.max(0, (Date.now() - ts) / 1000);
    if (diffSec < 45) return "just now";
    if (diffSec < 90) return "a minute ago";
    const min = Math.round(diffSec / 60);
    if (min < 45) return `${min} minutes ago`;
    if (min < 90) return "an hour ago";
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr} hours ago`;
    if (hr < 36) return "yesterday";
    const day = Math.round(hr / 24);
    if (day < 30) return `${day} days ago`;
    return new Date(ts).toLocaleDateString();
  }

  function add(text) {
    const trimmed = text.trim().slice(0, MAX_LENGTH);
    if (!trimmed) return;
    postings.unshift({ id: uid(), text: trimmed, createdAt: Date.now() });
    save();
    render();
  }

  function remove(id) {
    const before = postings.length;
    postings = postings.filter((p) => p.id !== id);
    if (postings.length !== before) {
      save();
      render();
    }
  }

  function render() {
    list.innerHTML = "";
    if (postings.length === 0) {
      empty.hidden = false;
      count.textContent = "";
    } else {
      empty.hidden = true;
      count.textContent =
        postings.length === 1 ? "1 post" : `${postings.length} posts`;
      for (const p of postings) {
        const li = document.createElement("li");
        li.className = "posting";
        li.dataset.id = p.id;
        li.innerHTML =
          '<div class="posting__body"></div>' +
          '<div class="posting__meta">' +
          '<time class="posting__time"></time>' +
          '<button type="button" class="posting__delete" aria-label="Delete posting">Delete</button>' +
          "</div>";
        const body = li.querySelector(".posting__body");
        body.innerHTML = escapeHtml(p.text).replace(/\n/g, "<br>");
        const time = li.querySelector(".posting__time");
        time.dateTime = new Date(p.createdAt).toISOString();
        time.textContent = relativeTime(p.createdAt);
        li.querySelector(".posting__delete").addEventListener("click", () => {
          remove(p.id);
        });
        list.appendChild(li);
      }
    }
    updateComposeState();
  }

  function updateComposeState() {
    const length = input.value.length;
    const trimmed = input.value.trim().length;
    remaining.textContent = String(MAX_LENGTH - length);
    submit.disabled = trimmed === 0;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    add(input.value);
    input.value = "";
    updateComposeState();
    input.focus();
  });

  input.addEventListener("input", updateComposeState);

  // ⌘/Ctrl+Enter posts from inside the textarea without leaving the keyboard.
  input.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (!submit.disabled) form.requestSubmit();
    }
  });

  // Keep timestamps fresh while the welcome page is visible.
  setInterval(() => {
    const items = list.querySelectorAll(".posting");
    items.forEach((li) => {
      const p = postings.find((x) => x.id === li.dataset.id);
      if (!p) return;
      const time = li.querySelector(".posting__time");
      if (time) time.textContent = relativeTime(p.createdAt);
    });
  }, 60_000);

  render();
})();
