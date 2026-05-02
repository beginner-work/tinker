// Backend client + SSE reader. All network I/O for the chat client lives here.
//
// Backend URL is resolved once per session via the main process (which knows
// dev/prod and can optionally fetch the latest Vercel preview deployment).
// CORS is wide open server-side, and the main process rewrites the Origin
// header to a stable value, so cross-origin fetch from `file://` works.

let backendCache = null;

export async function getBackendUrl() {
  if (backendCache) return backendCache;
  backendCache = await window.api.getBackendUrl();
  return backendCache;
}

async function backendFetch(path, init = {}) {
  const base = await getBackendUrl();
  const url = `${base.replace(/\/+$/, "")}${path}`;
  return fetch(url, init);
}

// ── Auth ───────────────────────────────────────────────────────────────────

export async function signup(email, password) {
  const res = await backendFetch("/claude/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error || `HTTP ${res.status}`);
  return body; // { token, user: { id, email } }
}

export async function login(email, password) {
  const res = await backendFetch("/claude/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error || `HTTP ${res.status}`);
  return body;
}

// ── Chat (SSE) ──────────────────────────────────────────────────────────────

// Returns a Response. The caller branches on status:
//   200 → consume body via `streamSse(response, handlers)`
//   anything else → JSON error (already-read body is on `error.body`)
export async function startChat({ token, messages, model, signal }) {
  const res = await backendFetch("/claude/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify(model ? { messages, model } : { messages }),
    signal,
  });
  return res;
}

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// ── SSE parsing ─────────────────────────────────────────────────────────────
//
// Spec note: we *cannot* use EventSource — it can't carry a custom
// Authorization header. So we read response.body manually and parse the
// `text/event-stream` framing ourselves.

// Consumes the SSE body, calling handlers per event. Handlers:
//   onEvent(type, data)   — every parsed event (data is the raw JSON object)
//   onText(deltaText)     — convenience: text_delta increments
//   onError(err)          — upstream `event: error` payloads
//   onDone()              — stream end (graceful)
export async function streamSse(response, handlers = {}) {
  if (!response.body) throw new Error("Response has no body to stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // Events are separated by a blank line. Parse complete events out of
      // the buffer and leave any partial trailing event for the next chunk.
      let sep;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        dispatchEvent(raw, handlers);
      }
    }
  } finally {
    handlers.onDone?.();
  }
}

function dispatchEvent(raw, handlers) {
  let event = "message";
  let dataLines = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    // ignore comments (lines starting with ":") and unknown fields
  }
  if (dataLines.length === 0) return;
  const dataStr = dataLines.join("\n");

  let data;
  try {
    data = JSON.parse(dataStr);
  } catch {
    // Anthropic always sends JSON; if we ever see raw text just forward it.
    data = { _raw: dataStr };
  }

  handlers.onEvent?.(event, data);

  if (event === "content_block_delta" && data?.delta?.type === "text_delta") {
    handlers.onText?.(data.delta.text || "");
  } else if (event === "error") {
    handlers.onError?.(new Error(data?.message || "stream error"));
  }
  // thinking_delta events are ignored by default — the chat UI doesn't
  // surface chain-of-thought yet (TODO: optional thinking pane).
}
