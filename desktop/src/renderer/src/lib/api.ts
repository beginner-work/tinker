import type { AuthResult, ChatError, ChatMessage } from "../types";
import { storage } from "./storage";

async function backend(): Promise<string> {
  return await storage.getBackendUrl();
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const base = await backend();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // Server sends JSON for both success and error here.
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new Error(`Server returned non-JSON (status ${res.status})`);
  }
  if (!res.ok) {
    const message =
      (parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : "") || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return parsed as T;
}

export function signup(
  email: string,
  password: string
): Promise<AuthResult> {
  return postJson<AuthResult>("/claude/auth/signup", { email, password });
}

export function login(
  email: string,
  password: string
): Promise<AuthResult> {
  return postJson<AuthResult>("/claude/auth/login", { email, password });
}

// ── Streaming chat ──────────────────────────────────────────────────────

export interface StreamHandlers {
  onText: (chunk: string) => void;
  onThinking?: (chunk: string) => void;
  onError: (err: ChatError) => void;
  onDone: () => void;
  signal?: AbortSignal;
}

interface SseEvent {
  type: string;
  data: string;
}

// Parse one SSE block ("event: foo\ndata: {...}"). Returns null if the block
// doesn't have an event line or is otherwise malformed — we just skip it.
function parseSseBlock(raw: string): SseEvent | null {
  let type = "";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      type = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
    // ignore other fields (id:, retry:, comments)
  }
  if (!type) return null;
  return { type, data: dataLines.join("\n") };
}

// Drain the SSE response body. Splits on "\n\n", parses each block, fans out
// to the right handler. The `event: error` case from the spec arrives as an
// SSE event with type === "error" — we surface it via onError but still let
// the stream end gracefully (don't crash the chat).
async function consumeStream(
  res: Response,
  handlers: StreamHandlers
): Promise<void> {
  if (!res.body) {
    handlers.onError({ kind: "network", message: "No response body" });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line.
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const ev = parseSseBlock(raw);
        if (!ev) continue;
        dispatch(ev, handlers);
      }
    }
    // Flush a trailing event without a final blank line.
    if (buffer.trim()) {
      const ev = parseSseBlock(buffer);
      if (ev) dispatch(ev, handlers);
    }
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") return;
    handlers.onError({
      kind: "network",
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    handlers.onDone();
  }
}

function dispatch(ev: SseEvent, handlers: StreamHandlers): void {
  if (ev.type === "error") {
    let message = "Upstream error";
    try {
      const body = JSON.parse(ev.data) as { message?: string };
      if (body && typeof body.message === "string") message = body.message;
    } catch {
      // fall through with the default message
    }
    handlers.onError({ kind: "stream", message });
    return;
  }
  if (ev.type !== "content_block_delta") return;
  let payload: { delta?: { type?: string; text?: string; thinking?: string } };
  try {
    payload = JSON.parse(ev.data);
  } catch {
    return;
  }
  const delta = payload.delta;
  if (!delta) return;
  if (delta.type === "text_delta" && typeof delta.text === "string") {
    handlers.onText(delta.text);
  } else if (
    delta.type === "thinking_delta" &&
    typeof delta.thinking === "string"
  ) {
    handlers.onThinking?.(delta.thinking);
  }
}

export async function streamChat(
  token: string,
  messages: ChatMessage[],
  handlers: StreamHandlers
): Promise<void> {
  const base = await backend();
  let res: Response;
  try {
    res = await fetch(`${base}/claude/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messages }),
      signal: handlers.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      handlers.onDone();
      return;
    }
    handlers.onError({
      kind: "network",
      message: err instanceof Error ? err.message : String(err),
    });
    handlers.onDone();
    return;
  }

  // Branch on status before parsing the body — only 200 is SSE.
  if (res.status === 200) {
    await consumeStream(res, handlers);
    return;
  }

  let body: { error?: string; retry_at?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // empty / non-JSON — fall through with body still {}
  }
  const message = body.error || `Request failed (${res.status})`;
  if (res.status === 401) {
    handlers.onError({ kind: "unauthorized", message });
  } else if (res.status === 429) {
    handlers.onError({
      kind: "rate_limit",
      message,
      retryAt: body.retry_at,
    });
  } else if (res.status === 503) {
    handlers.onError({ kind: "misconfigured", message });
  } else if (res.status === 400) {
    handlers.onError({ kind: "bad_request", message });
  } else {
    handlers.onError({ kind: "unknown", message });
  }
  handlers.onDone();
}
