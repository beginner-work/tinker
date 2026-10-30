/* Floating Tinker Ask pill for any page with a narration <audio>.
 *
 * The browser never sees TINKER_SERVICE_TOKEN. All STT / ask traffic goes
 * through the host `proxyUrl` (POST ${proxyUrl}/transcribe and
 * ${proxyUrl}/ask). Hosts implement those routes with TinkerClient.
 */

import type { AskResult, TalkPosition, TranscribeResult } from "../types";
import { TINKER_MARK_SVG } from "./logo";
import { ensureAskPillStyles } from "./styles";

export type AskPillState =
  | "idle"
  | "open"
  | "recording"
  | "transcribing"
  | "editing"
  | "asking"
  | "speaking"
  | "error";

export type AskPillMode = "voice" | "typed";

export interface AskPillPositionProvider {
  (): TalkPosition | null | undefined;
}

export interface AskPillCreateOptions {
  /** Element or selector to mount into. Defaults to document.body. */
  mount?: string | HTMLElement | null;
  /**
   * Host proxy base URL. The widget POSTs to `${proxyUrl}/transcribe`
   * and `${proxyUrl}/ask`. Tokens stay on the server.
   */
  proxyUrl: string;
  /** Optional absolute overrides (otherwise derived from proxyUrl). */
  transcribeUrl?: string;
  askUrl?: string;
  /** Grounding source id, e.g. "lindowlabs-minds-and-models". */
  sourceId: string;
  /** Narration audio to pause while asking. Element, selector, or null. */
  audioElement?: string | HTMLAudioElement | null;
  /** Default input mode when the panel opens. */
  defaultMode?: AskPillMode;
  /** Optional headers for proxy calls (object or lazy function). */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** Extra context string/object forwarded to /ask. */
  context?: string | Record<string, unknown> | (() => string | Record<string, unknown> | undefined);
  /** Listener position in the talk when interrupting. */
  getPosition?: AskPillPositionProvider;
  /** Called before recording / typing begins (pause narration). */
  onPause?: () => void;
  /** Called after the answer finishes (or the panel closes). */
  onResume?: () => void;
  onTranscript?: (result: TranscribeResult & { editedText: string }) => void;
  onAnswer?: (result: AskResult) => void;
  onError?: (err: Error) => void;
  onStateChange?: (state: AskPillState) => void;
  /** fetch override for tests. */
  fetch?: typeof fetch;
  labelPill?: string;
  labelAsk?: string;
  credentials?: RequestCredentials;
}

export interface AskPillHandle {
  open: () => void;
  close: () => void;
  startVoice: () => Promise<void>;
  stopVoice: () => void;
  submit: () => Promise<void>;
  destroy: () => void;
  getState: () => AskPillState;
  getTranscript: () => string;
  setTranscript: (text: string) => void;
}

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function resolveEl(target: string | HTMLElement | null | undefined): HTMLElement | null {
  if (!target) return null;
  if (typeof target === "string") {
    if (typeof document === "undefined") return null;
    return document.querySelector(target);
  }
  return target;
}

function isAudioElement(el: Element | null | undefined): el is HTMLAudioElement {
  if (!el) return false;
  // Duck-type: jsdom may not expose HTMLAudioElement on the Node global.
  const anyEl = el as HTMLAudioElement;
  return typeof anyEl.play === "function" && typeof anyEl.pause === "function" && "paused" in anyEl;
}

function resolveAudio(
  target: string | HTMLAudioElement | null | undefined,
): HTMLAudioElement | null {
  if (!target) return null;
  if (typeof target === "string") {
    if (typeof document === "undefined") return null;
    const el = document.querySelector(target);
    return isAudioElement(el) ? el : null;
  }
  return isAudioElement(target as unknown as Element) ? target : null;
}

function pickMimeType(MediaRecorderCtor: typeof MediaRecorder, candidates: string[]): string {
  if (!MediaRecorderCtor || typeof MediaRecorderCtor.isTypeSupported !== "function") return "";
  for (const c of candidates) {
    if (MediaRecorderCtor.isTypeSupported(c)) return c;
  }
  return "";
}

function extensionForMime(mime: string): string {
  const base = String(mime || "").split(";")[0].toLowerCase();
  if (base.includes("ogg")) return "ogg";
  if (base.includes("mp4") || base.includes("m4a")) return "mp4";
  if (base.includes("wav")) return "wav";
  return "webm";
}

function joinUrl(base: string, suffix: string): string {
  const b = String(base || "").replace(/\/$/, "");
  const s = String(suffix || "").replace(/^\//, "");
  return `${b}/${s}`;
}

function base64ToObjectUrl(base64: string, contentType = "audio/mpeg"): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: contentType });
  return URL.createObjectURL(blob);
}

export function createAskPill(options: AskPillCreateOptions): AskPillHandle {
  const opts = options || ({} as AskPillCreateOptions);
  if (!opts.proxyUrl || typeof opts.proxyUrl !== "string") {
    throw new Error("TinkerAsk.create requires proxyUrl");
  }
  if (!opts.sourceId || typeof opts.sourceId !== "string") {
    throw new Error("TinkerAsk.create requires sourceId");
  }

  const fetchFn = opts.fetch || fetch;
  const transcribeUrl = opts.transcribeUrl || joinUrl(opts.proxyUrl, "transcribe");
  const askUrl = opts.askUrl || joinUrl(opts.proxyUrl, "ask");

  let state: AskPillState = "idle";
  let mode: AskPillMode = opts.defaultMode === "typed" ? "typed" : "voice";
  let destroyed = false;
  let rawTranscript = "";
  let mediaStream: MediaStream | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let answerObjectUrl: string | null = null;
  let narrationWasPlaying = false;
  let answerAudio: HTMLAudioElement | null = null;

  ensureAskPillStyles();

  const mountParent = resolveEl(opts.mount) || (typeof document !== "undefined" ? document.body : null);
  if (!mountParent) throw new Error("No mount element available");

  const root = document.createElement("div");
  root.className = "tinker-ask";
  root.setAttribute("data-tinker-ask", "1");

  const panel = document.createElement("div");
  panel.className = "tinker-ask__panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Ask Tinker");

  const header = document.createElement("div");
  header.className = "tinker-ask__header";
  const title = document.createElement("p");
  title.className = "tinker-ask__title";
  title.textContent = "Ask";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tinker-ask__close";
  closeBtn.textContent = "Close";
  header.appendChild(title);
  header.appendChild(closeBtn);

  const modes = document.createElement("div");
  modes.className = "tinker-ask__modes";
  const voiceModeBtn = document.createElement("button");
  voiceModeBtn.type = "button";
  voiceModeBtn.className = "tinker-ask__mode";
  voiceModeBtn.textContent = "Voice";
  const typedModeBtn = document.createElement("button");
  typedModeBtn.type = "button";
  typedModeBtn.className = "tinker-ask__mode";
  typedModeBtn.textContent = "Type";
  modes.appendChild(voiceModeBtn);
  modes.appendChild(typedModeBtn);

  const transcript = document.createElement("textarea");
  transcript.className = "tinker-ask__transcript";
  transcript.placeholder = "Your question…";
  transcript.setAttribute("aria-label", "Question transcript");

  const actions = document.createElement("div");
  actions.className = "tinker-ask__actions";
  const recordBtn = document.createElement("button");
  recordBtn.type = "button";
  recordBtn.className = "tinker-ask__btn";
  recordBtn.textContent = "Hold to talk";
  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className = "tinker-ask__btn tinker-ask__btn--primary";
  submitBtn.textContent = opts.labelAsk || "Ask";
  actions.appendChild(recordBtn);
  actions.appendChild(submitBtn);

  const status = document.createElement("p");
  status.className = "tinker-ask__status";
  status.setAttribute("aria-live", "polite");

  const answerEl = document.createElement("p");
  answerEl.className = "tinker-ask__answer";

  panel.appendChild(header);
  panel.appendChild(modes);
  panel.appendChild(transcript);
  panel.appendChild(actions);
  panel.appendChild(status);
  panel.appendChild(answerEl);

  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "tinker-ask__pill";
  pill.setAttribute("aria-label", opts.labelPill || "Ask with Tinker");
  const logo = document.createElement("span");
  logo.className = "tinker-ask__pill-logo";
  logo.innerHTML = TINKER_MARK_SVG;
  const pillLabel = document.createElement("span");
  pillLabel.textContent = opts.labelPill || "Ask";
  pill.appendChild(logo);
  pill.appendChild(pillLabel);

  root.appendChild(panel);
  root.appendChild(pill);
  mountParent.appendChild(root);

  function setStatus(text: string): void {
    status.textContent = text || "";
  }

  function syncModeUi(): void {
    voiceModeBtn.setAttribute("aria-pressed", mode === "voice" ? "true" : "false");
    typedModeBtn.setAttribute("aria-pressed", mode === "typed" ? "true" : "false");
    recordBtn.hidden = mode !== "voice";
    recordBtn.textContent = state === "recording" ? "Stop" : "Hold to talk";
  }

  function setState(next: AskPillState): void {
    if (destroyed) return;
    state = next;
    root.classList.toggle("tinker-ask--open", next !== "idle");
    const busy = next === "transcribing" || next === "asking" || next === "speaking";
    submitBtn.disabled = busy || !String(transcript.value || "").trim();
    recordBtn.disabled = busy;
    transcript.readOnly = busy;
    syncModeUi();
    if (typeof opts.onStateChange === "function") {
      try {
        opts.onStateChange(next);
      } catch {
        /* ignore */
      }
    }
  }

  function fail(err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err || "Ask failed"));
    setStatus(error.message);
    setState("error");
    if (typeof opts.onError === "function") {
      try {
        opts.onError(error);
      } catch {
        /* ignore */
      }
    }
  }

  function resolveHeaders(): Record<string, string> {
    if (typeof opts.headers === "function") return opts.headers() || {};
    return opts.headers && typeof opts.headers === "object" ? { ...opts.headers } : {};
  }

  function resolveContext(): string | Record<string, unknown> | undefined {
    if (typeof opts.context === "function") return opts.context();
    return opts.context;
  }

  function pauseNarration(): void {
    const audio = resolveAudio(opts.audioElement ?? null);
    narrationWasPlaying = !!(audio && !audio.paused && !audio.ended);
    if (audio && narrationWasPlaying) {
      try {
        audio.pause();
      } catch {
        /* ignore */
      }
    }
    if (typeof opts.onPause === "function") {
      try {
        opts.onPause();
      } catch {
        /* ignore */
      }
    }
  }

  function resumeNarration(): void {
    if (typeof opts.onResume === "function") {
      try {
        opts.onResume();
      } catch {
        /* ignore */
      }
    }
    const audio = resolveAudio(opts.audioElement ?? null);
    if (audio && narrationWasPlaying) {
      try {
        void audio.play();
      } catch {
        /* ignore */
      }
    }
    narrationWasPlaying = false;
  }

  function cleanupRecorder(): void {
    if (mediaRecorder) {
      try {
        if (mediaRecorder.state === "recording" || mediaRecorder.state === "paused") {
          mediaRecorder.stop();
        }
      } catch {
        /* ignore */
      }
    }
    mediaRecorder = null;
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
    }
    mediaStream = null;
    chunks = [];
  }

  function revokeAnswerUrl(): void {
    if (answerObjectUrl) {
      try {
        URL.revokeObjectURL(answerObjectUrl);
      } catch {
        /* ignore */
      }
    }
    answerObjectUrl = null;
    if (answerAudio) {
      try {
        answerAudio.pause();
      } catch {
        /* ignore */
      }
      answerAudio = null;
    }
  }

  async function uploadAudio(blob: Blob, mimeType: string): Promise<void> {
    setState("transcribing");
    setStatus("Listening…");
    const form = new FormData();
    form.append("audio", blob, `recording.${extensionForMime(mimeType)}`);
    const headers = resolveHeaders();
    const fetchHeaders: Record<string, string> = {};
    Object.keys(headers).forEach((key) => {
      if (/^content-type$/i.test(key)) return;
      fetchHeaders[key] = headers[key];
    });

    const res = await fetchFn(transcribeUrl, {
      method: "POST",
      headers: fetchHeaders,
      body: form,
      credentials: opts.credentials || "same-origin",
    });
    const json = (await res.json().catch(() => ({}))) as TranscribeResult & { error?: string };
    if (!res.ok) throw new Error(json.error || `Transcribe failed (${res.status})`);

    rawTranscript = typeof json.text === "string" ? json.text : "";
    transcript.value = rawTranscript;
    setStatus(rawTranscript ? "Edit your question, then Ask." : "No speech detected — type instead.");
    setState("editing");
    if (typeof opts.onTranscript === "function") {
      opts.onTranscript({
        text: rawTranscript,
        words: Array.isArray(json.words) ? json.words : [],
        durationMs: typeof json.durationMs === "number" ? json.durationMs : null,
        requestId: json.requestId ? String(json.requestId) : "",
        editedText: transcript.value,
      });
    }
  }

  async function startVoice(): Promise<void> {
    if (destroyed) return Promise.reject(new Error("destroyed"));
    if (state === "recording" || state === "transcribing" || state === "asking") {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone is not available in this browser.");
    }
    const MR = typeof MediaRecorder !== "undefined" ? MediaRecorder : null;
    if (!MR) throw new Error("MediaRecorder is not available in this browser.");

    pauseNarration();
    mode = "voice";
    syncModeUi();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStream = stream;
    chunks = [];
    const mimeType = pickMimeType(MR, MIME_CANDIDATES);
    try {
      mediaRecorder = mimeType ? new MR(stream, { mimeType }) : new MR(stream);
    } catch {
      mediaRecorder = new MR(stream);
    }
    const usedMime = mediaRecorder.mimeType || mimeType || "audio/webm";
    mediaRecorder.ondataavailable = (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };
    mediaRecorder.onerror = () => {
      fail(new Error("Recording failed."));
      cleanupRecorder();
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: usedMime });
      cleanupRecorder();
      if (!blob.size) {
        fail(new Error("No audio captured."));
        return;
      }
      void uploadAudio(blob, usedMime).catch(fail);
    };
    mediaRecorder.start();
    setStatus("Listening… tap Stop when done.");
    setState("recording");
  }

  function stopVoice(): void {
    if (destroyed) return;
    if (!mediaRecorder || state !== "recording") return;
    try {
      if (mediaRecorder.state === "recording" || mediaRecorder.state === "paused") {
        mediaRecorder.stop();
      }
    } catch (err) {
      fail(err);
      cleanupRecorder();
    }
  }

  async function submit(): Promise<void> {
    if (destroyed) return;
    const question = String(transcript.value || "").trim();
    if (!question) {
      fail(new Error("Type or speak a question first."));
      return;
    }
    pauseNarration();
    setState("asking");
    setStatus("Thinking…");
    answerEl.textContent = "";
    revokeAnswerUrl();

    const headers = {
      "Content-Type": "application/json",
      ...resolveHeaders(),
    };
    const position =
      typeof opts.getPosition === "function" ? opts.getPosition() || undefined : undefined;
    const context = resolveContext();
    const body: Record<string, unknown> = {
      question,
      input: mode,
      sourceId: opts.sourceId,
    };
    if (mode === "voice" && rawTranscript) body.rawTranscript = rawTranscript;
    if (position) body.position = position;
    if (context != null) body.context = context;

    const res = await fetchFn(askUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      credentials: opts.credentials || "same-origin",
    });
    const json = (await res.json().catch(() => ({}))) as AskResult & { error?: string };
    if (!res.ok) throw new Error(json.error || `Ask failed (${res.status})`);

    const result: AskResult = {
      answerText: typeof json.answerText === "string" ? json.answerText : "",
      audio: typeof json.audio === "string" ? json.audio : "",
      requestId: json.requestId ? String(json.requestId) : "",
      latencyMs: typeof json.latencyMs === "number" ? json.latencyMs : 0,
      label: json.label ? String(json.label) : undefined,
    };
    answerEl.textContent = result.answerText;
    if (typeof opts.onAnswer === "function") opts.onAnswer(result);

    if (result.audio) {
      setState("speaking");
      setStatus(result.label || "Tyler's agent");
      answerObjectUrl = base64ToObjectUrl(result.audio);
      answerAudio = new Audio(answerObjectUrl);
      await new Promise<void>((resolve) => {
        if (!answerAudio) return resolve();
        answerAudio.onended = () => resolve();
        answerAudio.onerror = () => resolve();
        void answerAudio.play().catch(() => resolve());
      });
    }

    setStatus("");
    setState("open");
    resumeNarration();
  }

  function open(): void {
    if (destroyed) return;
    pauseNarration();
    answerEl.textContent = "";
    setStatus("");
    setState("open");
    syncModeUi();
    transcript.focus();
  }

  function close(): void {
    if (destroyed) return;
    stopVoice();
    cleanupRecorder();
    revokeAnswerUrl();
    setState("idle");
    resumeNarration();
  }

  function destroy(): void {
    destroyed = true;
    stopVoice();
    cleanupRecorder();
    revokeAnswerUrl();
    if (root.parentNode) root.parentNode.removeChild(root);
    state = "idle";
  }

  pill.addEventListener("click", () => open());
  closeBtn.addEventListener("click", () => close());
  voiceModeBtn.addEventListener("click", () => {
    mode = "voice";
    syncModeUi();
  });
  typedModeBtn.addEventListener("click", () => {
    mode = "typed";
    if (state === "recording") stopVoice();
    syncModeUi();
    transcript.focus();
  });
  recordBtn.addEventListener("click", () => {
    if (state === "recording") stopVoice();
    else void startVoice().catch(fail);
  });
  submitBtn.addEventListener("click", () => {
    void submit().catch(fail);
  });
  transcript.addEventListener("input", () => {
    submitBtn.disabled =
      state === "transcribing" ||
      state === "asking" ||
      state === "speaking" ||
      !String(transcript.value || "").trim();
    if (state === "open" || state === "editing" || state === "error") {
      setState(String(transcript.value || "").trim() ? "editing" : "open");
    }
  });

  syncModeUi();
  setState("idle");

  return {
    open,
    close,
    startVoice,
    stopVoice,
    submit,
    destroy,
    getState: () => state,
    getTranscript: () => String(transcript.value || ""),
    setTranscript: (text: string) => {
      transcript.value = String(text || "");
      rawTranscript = transcript.value;
      submitBtn.disabled = !transcript.value.trim();
    },
  };
}

/** Browser global / CJS facade matching TinkerVoice style. */
export const TinkerAsk = {
  create: createAskPill,
  _pickMimeType: pickMimeType,
  _extensionForMime: extensionForMime,
  _joinUrl: joinUrl,
  _base64ToObjectUrl: base64ToObjectUrl,
};

export type { TranscribeResult, AskResult, TalkPosition };
