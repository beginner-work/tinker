import { startChat, streamSse, ApiError } from "./api.js";

// Conversation = { id, title, messages: [{role, content}] }.
// In-memory only for v1. TODO: persist via main process (sqlite or a JSON
// file in app.getPath("userData")). The backend is stateless — every send
// posts the full message history.

export function mountChat({ token, user, onLogout, on401 }) {
  const conversations = new Map();
  let activeId = null;
  let streaming = false;
  let abortController = null;

  const listEl = document.getElementById("chat-list");
  const threadEl = document.getElementById("chat-thread");
  const titleEl = document.getElementById("chat-title");
  const composer = document.getElementById("chat-composer");
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");
  const banner = document.getElementById("chat-banner");
  const userLabel = document.getElementById("chat-user");
  const newBtn = document.getElementById("chat-new");
  const logoutBtn = document.getElementById("chat-logout");

  userLabel.textContent = user?.email || "";

  function newConversation() {
    const id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    conversations.set(id, { id, title: "New conversation", messages: [] });
    activeId = id;
    renderList();
    renderThread();
    input.focus();
  }

  function pickConversation(id) {
    if (streaming) return;
    activeId = id;
    renderList();
    renderThread();
  }

  function renderList() {
    listEl.innerHTML = "";
    for (const conv of conversations.values()) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "chat-rail__item";
      item.setAttribute("aria-selected", String(conv.id === activeId));
      item.textContent = conv.title;
      item.addEventListener("click", () => pickConversation(conv.id));
      listEl.appendChild(item);
    }
  }

  function renderThread() {
    const conv = conversations.get(activeId);
    titleEl.textContent = conv?.title || "New conversation";
    threadEl.innerHTML = "";
    if (!conv || conv.messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "chat-thread__empty";
      empty.textContent = "Ask Claude anything to get started.";
      threadEl.appendChild(empty);
      return;
    }
    for (const m of conv.messages) {
      threadEl.appendChild(renderMessage(m.role, contentToText(m.content)));
    }
    threadEl.scrollTop = threadEl.scrollHeight;
  }

  function renderMessage(role, text, { withCursor = false } = {}) {
    const wrap = document.createElement("div");
    wrap.className = `chat-msg chat-msg--${role}`;
    const r = document.createElement("div");
    r.className = "chat-msg__role";
    r.textContent = role === "user" ? "You" : "Claude";
    const body = document.createElement("div");
    body.className = "chat-msg__body";
    body.textContent = text;
    if (withCursor) {
      const cursor = document.createElement("span");
      cursor.className = "chat-msg__cursor";
      body.appendChild(cursor);
    }
    wrap.appendChild(r);
    wrap.appendChild(body);
    return wrap;
  }

  // Anthropic message content can be a string or an array of blocks. Our
  // user messages are always strings; on receive, we accumulate text deltas
  // into a string. This helper handles both for re-rendering existing messages.
  function contentToText(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
    }
    return "";
  }

  function setBanner(text, kind) {
    if (!text) {
      banner.hidden = true;
      banner.textContent = "";
      banner.className = "chat-banner";
      return;
    }
    banner.textContent = text;
    banner.className = `chat-banner${kind ? ` chat-banner--${kind}` : ""}`;
    banner.hidden = false;
  }

  function setComposerEnabled(enabled) {
    streaming = !enabled;
    input.disabled = !enabled;
    sendBtn.disabled = !enabled;
  }

  async function send(text) {
    let conv = conversations.get(activeId);
    if (!conv) {
      newConversation();
      conv = conversations.get(activeId);
    }

    conv.messages.push({ role: "user", content: text });
    if (conv.title === "New conversation") {
      conv.title = text.length > 36 ? `${text.slice(0, 36)}…` : text;
    }
    renderList();
    renderThread();

    // Append a streaming assistant message that we mutate as deltas arrive.
    let assistantText = "";
    const assistantBubble = renderMessage("assistant", "", { withCursor: true });
    threadEl.appendChild(assistantBubble);
    const bodyEl = assistantBubble.querySelector(".chat-msg__body");
    threadEl.scrollTop = threadEl.scrollHeight;

    setComposerEnabled(false);
    setBanner(null);

    abortController = new AbortController();
    let res;
    try {
      res = await startChat({
        token,
        messages: conv.messages.map((m) => ({ role: m.role, content: m.content })),
        signal: abortController.signal,
      });
    } catch (err) {
      assistantBubble.remove();
      setBanner(`Network error: ${err.message}`);
      setComposerEnabled(true);
      return;
    }

    // Status branching per spec: only 200 is SSE; everything else is JSON.
    if (res.status === 200) {
      try {
        await streamSse(res, {
          onText: (delta) => {
            assistantText += delta;
            bodyEl.firstChild
              ? (bodyEl.firstChild.nodeValue = assistantText)
              : bodyEl.insertBefore(document.createTextNode(assistantText), bodyEl.firstChild);
            threadEl.scrollTop = threadEl.scrollHeight;
          },
          onError: (err) => {
            setBanner(`Stream error: ${err.message}`);
          },
          onDone: () => {
            // Strip the typing cursor.
            const cur = bodyEl.querySelector(".chat-msg__cursor");
            cur?.remove();
            conv.messages.push({ role: "assistant", content: assistantText });
            setComposerEnabled(true);
          },
        });
      } catch (err) {
        setBanner(`Stream interrupted: ${err.message}`);
        setComposerEnabled(true);
      }
      return;
    }

    // Non-200: JSON error envelope.
    let body = {};
    try { body = await res.json(); } catch {}
    assistantBubble.remove();

    if (res.status === 401) {
      setComposerEnabled(true);
      on401();
      return;
    }
    if (res.status === 429) {
      const when = body.retry_at ? new Date(body.retry_at) : null;
      const localTime = when && !isNaN(when.getTime())
        ? when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
        : "later";
      setBanner(`Daily limit reached, resets at ${localTime}.`);
      setComposerEnabled(true);
      return;
    }
    if (res.status === 503) {
      setBanner("Server misconfigured — contact admin.", "server");
      setComposerEnabled(true);
      return;
    }
    setBanner(`Error ${res.status}: ${body.error || "unknown"}`);
    setComposerEnabled(true);
  }

  // ── Event wiring ──────────────────────────────────────────────────────────
  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    if (streaming) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    autoResize();
    send(text);
  });

  // Enter to send, Shift+Enter for newline. Multiline composer with auto-grow.
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      composer.requestSubmit();
    }
  });
  input.addEventListener("input", autoResize);
  function autoResize() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }

  newBtn.addEventListener("click", newConversation);
  logoutBtn.addEventListener("click", () => {
    abortController?.abort();
    onLogout();
  });

  newConversation();
}
