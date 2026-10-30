/* Server-side Tinker client. Holds the service token — never ship this
 * module to the browser. Hosts call transcribe()/ask() from their own
 * origin and proxy results to the Ask pill.
 */

import type {
  AskRequestBody,
  AskResult,
  TalkPosition,
  TranscribeResult,
  TinkerErrorBody,
} from "../types";

export interface TinkerClientOptions {
  /** Origin of the Tinker deploy, e.g. https://tinker.beginner.work */
  baseUrl?: string;
  /** Shared secret: Authorization Bearer / X-Tinker-Service-Token */
  serviceToken: string;
  /** X-Tinker-Caller label, e.g. "mysite.com" */
  caller?: string;
  /** Optional fetch override (tests). */
  fetch?: typeof fetch;
}

export interface TranscribeInput {
  /** Raw audio bytes. */
  audio: Buffer | Uint8Array | ArrayBuffer | Blob;
  /** MIME type of the audio (webm / ogg / mp4 / wav / mpeg). */
  mimeType: string;
  /** Multipart field name; defaults to "audio". */
  fieldName?: string;
  /** Filename hint for the multipart part. */
  filename?: string;
}

export interface AskInput {
  question: string;
  input: "voice" | "typed";
  sourceId: string;
  rawTranscript?: string;
  position?: TalkPosition;
  context?: string | Record<string, unknown>;
}

const DEFAULT_BASE = "https://tinker.beginner.work";

function extensionForMime(mime: string): string {
  const base = String(mime || "").split(";")[0].toLowerCase();
  if (base.includes("ogg")) return "ogg";
  if (base.includes("mp4") || base.includes("m4a")) return "mp4";
  if (base.includes("wav")) return "wav";
  if (base.includes("mpeg") || base.includes("mp3")) return "mp3";
  return "webm";
}

function toUint8Array(audio: TranscribeInput["audio"]): Uint8Array {
  if (typeof Blob !== "undefined" && audio instanceof Blob) {
    throw new Error("Pass a Buffer/Uint8Array for Node; use blob.arrayBuffer() first.");
  }
  if (audio instanceof ArrayBuffer) return new Uint8Array(audio);
  if (audio instanceof Uint8Array) return audio;
  throw new Error("audio must be a Buffer, Uint8Array, or ArrayBuffer");
}

export class TinkerClient {
  readonly baseUrl: string;
  readonly serviceToken: string;
  readonly caller: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: TinkerClientOptions) {
    const token = String(options.serviceToken || "").trim();
    if (!token) throw new Error("TinkerClient requires serviceToken");
    this.baseUrl = String(options.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
    this.serviceToken = token;
    this.caller = String(options.caller || "service").trim() || "service";
    this.fetchFn = options.fetch || fetch;
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.serviceToken}`,
      "X-Tinker-Caller": this.caller,
      ...(extra || {}),
    };
  }

  private async readJson<T>(res: Response): Promise<T> {
    let body: (T & TinkerErrorBody) | null = null;
    try {
      body = (await res.json()) as T & TinkerErrorBody;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const message =
        (body && (body.error || (body as { message?: string }).message)) ||
        `Tinker request failed (${res.status})`;
      const err = new Error(String(message)) as Error & {
        status?: number;
        requestId?: string;
      };
      err.status = res.status;
      if (body && body.requestId) err.requestId = String(body.requestId);
      throw err;
    }
    return body as T;
  }

  /** POST /api/transcribe with multipart audio. */
  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    const mimeType = String(input.mimeType || "").trim();
    if (!mimeType) throw new Error("mimeType is required");
    const bytes = toUint8Array(input.audio);
    const fieldName = input.fieldName || "audio";
    const filename = input.filename || `audio.${extensionForMime(mimeType)}`;

    const form = new FormData();
    // Copy into a standalone ArrayBuffer so Blob gets a clean view.
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy], { type: mimeType });
    form.append(fieldName, blob, filename);

    const res = await this.fetchFn(`${this.baseUrl}/api/transcribe`, {
      method: "POST",
      headers: this.authHeaders(),
      body: form,
    });
    const json = await this.readJson<{
      text?: string;
      words?: TranscribeResult["words"];
      durationMs?: number | null;
      requestId?: string;
    }>(res);

    return {
      text: typeof json.text === "string" ? json.text : "",
      words: Array.isArray(json.words) ? json.words : [],
      durationMs: typeof json.durationMs === "number" ? json.durationMs : null,
      requestId: json.requestId ? String(json.requestId) : "",
    };
  }

  /** POST /api/ask with a grounded question. */
  async ask(input: AskInput): Promise<AskResult> {
    const question = String(input.question || "").trim();
    if (!question) throw new Error("question is required");
    const sourceId = String(input.sourceId || "").trim();
    if (!sourceId) throw new Error("sourceId is required");
    if (input.input !== "voice" && input.input !== "typed") {
      throw new Error('input must be "voice" or "typed"');
    }

    const body: AskRequestBody = {
      question,
      input: input.input,
      sourceId,
    };
    if (input.rawTranscript != null) body.rawTranscript = String(input.rawTranscript);
    if (input.position) body.position = input.position;
    if (input.context != null) body.context = input.context;

    const res = await this.fetchFn(`${this.baseUrl}/api/ask`, {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    const json = await this.readJson<{
      answerText?: string;
      audio?: string;
      requestId?: string;
      latencyMs?: number;
      label?: string;
    }>(res);

    return {
      answerText: typeof json.answerText === "string" ? json.answerText : "",
      audio: typeof json.audio === "string" ? json.audio : "",
      requestId: json.requestId ? String(json.requestId) : "",
      latencyMs: typeof json.latencyMs === "number" ? json.latencyMs : 0,
      label: json.label ? String(json.label) : undefined,
    };
  }
}

export function createTinkerClient(options: TinkerClientOptions): TinkerClient {
  return new TinkerClient(options);
}
