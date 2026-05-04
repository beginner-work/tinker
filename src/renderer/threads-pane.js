/* tinker — threads pane
 *
 * A Threads-style social feed rendered as an internal session
 * (tinker://threads). Posts persist in localStorage so a feed
 * stays put across sessions. The pane is built dynamically the
 * same way the search-pane is, so the renderer just hands us a
 * stage element and we do the rest.
 *
 * Public surface:
 *   window.tinkerThreads.createPane(stage)
 *     -> returns a <section class="threads-pane"> ready to attach.
 */

(function () {
  "use strict";

  const STORE_KEY = "tinker.threads.v1";
  const ME = { name: "you", handle: "you", avatar: "✿", tint: "purple" };

  // A tiny seed feed so a brand-new install doesn't open onto a
  // blank page. The voice mirrors tinker's: calm, plainspoken,
  // a little wry. Avatars are emoji-as-glyph; tints map to the
  // brand pastel palette.
  const SEED_POSTS = [
    {
      id: "p_seed_1",
      author: { name: "tinker", handle: "tinker", avatar: "🌐", tint: "leaf" },
      text:
        "a quieter place to talk. no algorithm, no ads, no infinite scroll — just the people you follow and the things you wrote down.",
      ts: Date.now() - 1000 * 60 * 60 * 6,
      likes: 28,
      liked: false,
      reposts: 4,
      reposted: false,
      parentId: null,
      replyIds: ["p_seed_2"],
    },
    {
      id: "p_seed_2",
      author: { name: "june", handle: "june", avatar: "☀︎", tint: "honey" },
      text:
        "first thought: it's strange how loud the rest of the web feels once you've been here a while.",
      ts: Date.now() - 1000 * 60 * 60 * 5,
      likes: 11,
      liked: false,
      reposts: 1,
      reposted: false,
      parentId: "p_seed_1",
      replyIds: [],
    },
    {
      id: "p_seed_3",
      author: { name: "wren", handle: "wren", avatar: "❄︎", tint: "sky" },
      text:
        "i wrote a small thing this morning. nobody asked for it. that's the point.",
      ts: Date.now() - 1000 * 60 * 60 * 2,
      likes: 7,
      liked: false,
      reposts: 0,
      reposted: false,
      parentId: null,
      replyIds: [],
    },
    {
      id: "p_seed_4",
      author: { name: "moss", handle: "moss", avatar: "✿", tint: "rose" },
      text: "good morning. the kettle is on.",
      ts: Date.now() - 1000 * 60 * 28,
      likes: 4,
      liked: false,
      reposts: 0,
      reposted: false,
      parentId: null,
      replyIds: [],
    },
  ];

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { posts: SEED_POSTS.slice(), feed: "for-you" };
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.posts)) {
        return { posts: SEED_POSTS.slice(), feed: "for-you" };
      }
      return { posts: parsed.posts, feed: parsed.feed || "for-you" };
    } catch {
      return { posts: SEED_POSTS.slice(), feed: "for-you" };
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ posts: state.posts, feed: state.feed })
      );
    } catch {
      // localStorage might be full or disabled — fail quietly.
    }
  }

  const uid = () => "p_" + Math.random().toString(36).slice(2, 10);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  // Linkify @handles and bare URLs without re-injecting raw HTML.
  function renderText(text) {
    const escaped = escapeHtml(text);
    const linked = escaped.replace(
      /(https?:\/\/[^\s<]+)/g,
      (url) =>
        `<a class="thread__link" data-thread-link="${url}" href="${url}">${url}</a>`
    );
    const handled = linked.replace(
      /(^|[^@\w])@([a-z0-9_]{1,24})/gi,
      (_m, lead, name) =>
        `${lead}<span class="thread__mention">@${name}</span>`
    );
    return handled.replace(/\n/g, "<br>");
  }

  function relTime(ts) {
    const diff = Math.max(0, Date.now() - ts);
    const m = Math.round(diff / 60000);
    if (m < 1) return "now";
    if (m < 60) return m + "m";
    const h = Math.round(m / 60);
    if (h < 24) return h + "h";
    const d = Math.round(h / 24);
    if (d < 7) return d + "d";
    const w = Math.round(d / 7);
    if (w < 5) return w + "w";
    const mo = Math.round(d / 30);
    if (mo < 12) return mo + "mo";
    return Math.round(d / 365) + "y";
  }

  function avatarHtml(person) {
    const tint = person.tint || "purple";
    const glyph = person.avatar || person.name.slice(0, 1).toUpperCase();
    return (
      '<span class="thread__avatar" data-tint="' +
      tint +
      '" aria-hidden="true">' +
      escapeHtml(glyph) +
      "</span>"
    );
  }

  // ── Pane factory ───────────────────────────────────────────────────

  function createPane(stage) {
    const state = loadState();

    const pane = document.createElement("section");
    pane.className = "threads-pane";
    pane.setAttribute("aria-label", "Threads");

    pane.innerHTML = `
      <div class="threads-pane__inner">
        <header class="threads-pane__head">
          <h1 class="threads-pane__title">threads</h1>
          <p class="threads-pane__sub">a quieter place to say something.</p>
          <nav class="threads-pane__tabs" role="tablist" aria-label="Feed">
            <button class="threads-tab" role="tab" data-feed="for-you" aria-selected="true">For you</button>
            <button class="threads-tab" role="tab" data-feed="following">Following</button>
          </nav>
        </header>

        <form class="thread-composer" id="thread-composer">
          ${avatarHtml(ME)}
          <div class="thread-composer__body">
            <label class="thread-composer__label" for="thread-composer-input">
              <span class="thread-composer__handle">@${escapeHtml(ME.handle)}</span>
              <span class="thread-composer__hint">say something new</span>
            </label>
            <textarea
              id="thread-composer-input"
              class="thread-composer__input"
              rows="2"
              maxlength="500"
              placeholder="What's on your mind? You have 500 characters."
            ></textarea>
            <div class="thread-composer__row">
              <span class="thread-composer__count" aria-live="polite">500</span>
              <button type="submit" class="thread-composer__post" disabled>Post</button>
            </div>
          </div>
        </form>

        <div class="thread-feed" role="feed" aria-busy="false"></div>

        <footer class="threads-pane__footer">
          <span>nothing here is sponsored. nothing here is sorted by an engine.</span>
        </footer>
      </div>
    `;

    const feedEl = pane.querySelector(".thread-feed");
    const composer = pane.querySelector("#thread-composer");
    const composerInput = pane.querySelector("#thread-composer-input");
    const composerPost = pane.querySelector(".thread-composer__post");
    const composerCount = pane.querySelector(".thread-composer__count");
    const tabsEl = pane.querySelectorAll(".threads-tab");

    // ── State helpers ────────────────────────────────────────────────

    function findPost(id) {
      return state.posts.find((p) => p.id === id) || null;
    }

    function topLevel() {
      return state.posts.filter((p) => !p.parentId);
    }

    // ── Renderers ────────────────────────────────────────────────────

    function renderFeed() {
      feedEl.innerHTML = "";
      const tops = topLevel().slice().sort((a, b) => b.ts - a.ts);
      if (tops.length === 0) {
        feedEl.innerHTML = `
          <div class="thread-empty">
            <p>nothing yet. write the first thing — nobody is watching.</p>
          </div>
        `;
        return;
      }
      for (const post of tops) {
        feedEl.appendChild(renderThread(post));
      }
    }

    function renderThread(post) {
      const article = document.createElement("article");
      article.className = "thread";
      article.dataset.id = post.id;

      const replies = (post.replyIds || [])
        .map(findPost)
        .filter(Boolean)
        .sort((a, b) => a.ts - b.ts);

      article.appendChild(renderPost(post, { hasReplies: replies.length > 0 }));

      if (replies.length > 0) {
        const repliesEl = document.createElement("div");
        repliesEl.className = "thread__replies";
        for (const reply of replies) {
          repliesEl.appendChild(renderPost(reply, { isReply: true }));
        }
        article.appendChild(repliesEl);
      }

      return article;
    }

    function renderPost(post, { hasReplies = false, isReply = false } = {}) {
      const wrap = document.createElement("div");
      wrap.className = "thread__post" + (isReply ? " thread__post--reply" : "");
      wrap.dataset.id = post.id;

      wrap.innerHTML = `
        <div class="thread__rail">
          ${avatarHtml(post.author)}
          ${hasReplies ? '<span class="thread__line" aria-hidden="true"></span>' : ""}
        </div>
        <div class="thread__body">
          <header class="thread__head">
            <span class="thread__name">${escapeHtml(post.author.name)}</span>
            <span class="thread__handle">@${escapeHtml(post.author.handle)}</span>
            <span class="thread__dot" aria-hidden="true">·</span>
            <time class="thread__time" datetime="${new Date(post.ts).toISOString()}">${relTime(post.ts)}</time>
          </header>
          <p class="thread__text">${renderText(post.text)}</p>
          <div class="thread__actions">
            <button class="thread__action thread__action--like ${post.liked ? "is-on" : ""}" data-act="like" aria-label="Like" aria-pressed="${post.liked ? "true" : "false"}">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 10c0 5.65-7 10-7 10z"
                      fill="${post.liked ? "currentColor" : "none"}"
                      stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              </svg>
              <span class="thread__count">${post.likes || 0}</span>
            </button>
            <button class="thread__action" data-act="reply" aria-label="Reply">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M21 12c0 4.4-4 8-9 8a9.6 9.6 0 0 1-3.6-.7L3 21l1.4-4.3A8 8 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8z"
                      fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              </svg>
              <span class="thread__count">${(post.replyIds || []).length}</span>
            </button>
            <button class="thread__action ${post.reposted ? "is-on" : ""}" data-act="repost" aria-label="Repost" aria-pressed="${post.reposted ? "true" : "false"}">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M7 4l-3 3 3 3M4 7h11a4 4 0 0 1 4 4M17 20l3-3-3-3M20 17H9a4 4 0 0 1-4-4"
                      fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span class="thread__count">${post.reposts || 0}</span>
            </button>
            <button class="thread__action" data-act="share" aria-label="Share">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14"
                      fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
          <div class="thread__reply-form" hidden>
            ${avatarHtml(ME)}
            <div class="thread__reply-body">
              <textarea class="thread__reply-input" rows="1" maxlength="500" placeholder="Reply to @${escapeHtml(post.author.handle)}…"></textarea>
              <div class="thread__reply-row">
                <button type="button" class="thread__reply-cancel">Cancel</button>
                <button type="button" class="thread__reply-submit" disabled>Reply</button>
              </div>
            </div>
          </div>
        </div>
      `;

      return wrap;
    }

    // ── Actions ──────────────────────────────────────────────────────

    function postNew(text) {
      const trimmed = text.trim();
      if (!trimmed) return;
      const post = {
        id: uid(),
        author: { ...ME },
        text: trimmed,
        ts: Date.now(),
        likes: 0,
        liked: false,
        reposts: 0,
        reposted: false,
        parentId: null,
        replyIds: [],
      };
      state.posts.push(post);
      saveState(state);
      renderFeed();
    }

    function postReply(parentId, text) {
      const trimmed = text.trim();
      const parent = findPost(parentId);
      if (!trimmed || !parent) return;
      const reply = {
        id: uid(),
        author: { ...ME },
        text: trimmed,
        ts: Date.now(),
        likes: 0,
        liked: false,
        reposts: 0,
        reposted: false,
        parentId,
        replyIds: [],
      };
      state.posts.push(reply);
      parent.replyIds = parent.replyIds || [];
      parent.replyIds.push(reply.id);
      saveState(state);
      renderFeed();
    }

    function toggleLike(id) {
      const post = findPost(id);
      if (!post) return;
      post.liked = !post.liked;
      post.likes = Math.max(0, (post.likes || 0) + (post.liked ? 1 : -1));
      saveState(state);
      // Patch in place — full re-render closes inline reply forms.
      const btn = pane.querySelector(
        '.thread__post[data-id="' + post.id + '"] .thread__action--like'
      );
      if (btn) {
        btn.classList.toggle("is-on", post.liked);
        btn.setAttribute("aria-pressed", post.liked ? "true" : "false");
        const path = btn.querySelector("path");
        if (path) path.setAttribute("fill", post.liked ? "currentColor" : "none");
        const count = btn.querySelector(".thread__count");
        if (count) count.textContent = String(post.likes);
      }
    }

    function toggleRepost(id) {
      const post = findPost(id);
      if (!post) return;
      post.reposted = !post.reposted;
      post.reposts = Math.max(0, (post.reposts || 0) + (post.reposted ? 1 : -1));
      saveState(state);
      const btn = pane.querySelector(
        '.thread__post[data-id="' + post.id + '"] .thread__action[data-act="repost"]'
      );
      if (btn) {
        btn.classList.toggle("is-on", post.reposted);
        btn.setAttribute("aria-pressed", post.reposted ? "true" : "false");
        const count = btn.querySelector(".thread__count");
        if (count) count.textContent = String(post.reposts);
      }
    }

    // ── Wiring ───────────────────────────────────────────────────────

    composerInput.addEventListener("input", () => {
      const remaining = 500 - composerInput.value.length;
      composerCount.textContent = String(remaining);
      composerCount.classList.toggle("is-low", remaining < 60);
      composerPost.disabled = composerInput.value.trim().length === 0;
      autoGrow(composerInput);
    });

    composer.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = composerInput.value;
      if (!text.trim()) return;
      postNew(text);
      composerInput.value = "";
      composerCount.textContent = "500";
      composerCount.classList.remove("is-low");
      composerPost.disabled = true;
      autoGrow(composerInput);
    });

    // Cmd/Ctrl+Enter to post from the composer.
    composerInput.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        composer.requestSubmit();
      }
    });

    tabsEl.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabsEl.forEach((t) => t.setAttribute("aria-selected", "false"));
        tab.setAttribute("aria-selected", "true");
        state.feed = tab.dataset.feed;
        saveState(state);
        // Both tabs render the same feed for now — there's no follow
        // graph yet. The tab still toggles visually so the affordance
        // is honest about what'll change once that lands.
      });
      if (tab.dataset.feed === state.feed) {
        tabsEl.forEach((t) => t.setAttribute("aria-selected", "false"));
        tab.setAttribute("aria-selected", "true");
      }
    });

    // Delegate all per-post action clicks.
    feedEl.addEventListener("click", (e) => {
      const link = e.target.closest("a[data-thread-link]");
      if (link) {
        e.preventDefault();
        const url = link.getAttribute("data-thread-link");
        if (window.tinker && typeof window.tinker.openExternal === "function") {
          window.tinker.openExternal(url);
        } else {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }

      const btn = e.target.closest(".thread__action");
      if (btn) {
        const postEl = btn.closest(".thread__post");
        if (!postEl) return;
        const id = postEl.dataset.id;
        const act = btn.dataset.act;
        if (act === "like") toggleLike(id);
        else if (act === "repost") toggleRepost(id);
        else if (act === "reply") openReplyForm(postEl);
        else if (act === "share") shareLink(id);
        return;
      }

      const cancel = e.target.closest(".thread__reply-cancel");
      if (cancel) {
        const form = cancel.closest(".thread__reply-form");
        if (form) closeReplyForm(form);
        return;
      }

      const submit = e.target.closest(".thread__reply-submit");
      if (submit) {
        const postEl = submit.closest(".thread__post");
        const form = submit.closest(".thread__reply-form");
        if (!postEl || !form) return;
        const input = form.querySelector(".thread__reply-input");
        const text = input ? input.value : "";
        if (text.trim()) {
          postReply(postEl.dataset.id, text);
        }
        return;
      }
    });

    // Delegated input listener for reply textareas (auto-grow + enable
    // submit). Bound on feedEl so we don't have to re-bind per render.
    feedEl.addEventListener("input", (e) => {
      const input = e.target.closest(".thread__reply-input");
      if (!input) return;
      autoGrow(input);
      const submit = input.closest(".thread__reply-form").querySelector(".thread__reply-submit");
      if (submit) submit.disabled = input.value.trim().length === 0;
    });

    function openReplyForm(postEl) {
      const form = postEl.querySelector(".thread__reply-form");
      if (!form) return;
      form.hidden = false;
      const input = form.querySelector(".thread__reply-input");
      if (input) {
        autoGrow(input);
        input.focus();
      }
    }

    function closeReplyForm(form) {
      form.hidden = true;
      const input = form.querySelector(".thread__reply-input");
      if (input) input.value = "";
    }

    function shareLink(id) {
      const url = "tinker://threads#" + id;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url);
          flashShare(id);
          return;
        }
      } catch {}
      flashShare(id);
    }

    function flashShare(id) {
      const btn = pane.querySelector(
        '.thread__post[data-id="' + id + '"] .thread__action[data-act="share"]'
      );
      if (!btn) return;
      btn.classList.add("is-flash");
      setTimeout(() => btn.classList.remove("is-flash"), 700);
    }

    function autoGrow(el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 240) + "px";
    }

    // ── First render ─────────────────────────────────────────────────

    renderFeed();
    autoGrow(composerInput);

    return pane;
  }

  window.tinkerThreads = { createPane };
})();
