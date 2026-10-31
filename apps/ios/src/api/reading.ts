import { API_BASE_URL, PLATFORM } from "./config";
import { BANNED_VOICE_ID } from "@/src/theme/tokens";

export type ClientMeta = {
  anonymousId: string;
  owner?: "1";
};

export type SessionResponse = {
  sessionId: string;
  sourceUrl: string;
  title: string;
  author: string;
  authorSource?: string;
  authorUnknown?: boolean;
  siteName?: string;
  wordCount: number;
  companyHost: string;
  voiceId: string;
  preview: string;
  attribution: string;
  verbatim?: boolean;
  platform?: string;
};

export type SpeakResponse = {
  sessionId: string;
  audio: string;
  contentType?: string;
  voiceId: string;
  fromWordIndex: number;
  toWordIndex: number;
  done: boolean;
  wordCount: number;
  chunkText?: string;
  sourceUrl: string;
  title?: string;
  author?: string;
  attribution?: string;
};

export type AskResponse = {
  answerText: string;
  audio: string;
  requestId: string;
  latencyMs: number;
  sessionId: string;
  resumeWordIndex: number;
  fetchedSource: boolean;
  fetchedSourceUrl?: string;
  sourceUrl: string;
  title?: string;
  author?: string;
  attribution?: string;
  companyHost?: string;
};

function endpoint(action: string): string {
  return `${API_BASE_URL}/api/reading?action=${encodeURIComponent(action)}`;
}

async function postJson<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(endpoint(action), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Tinker-Caller": "ios",
    },
    body: JSON.stringify({ ...body, platform: PLATFORM }),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw Object.assign(new Error(data.error || `Request failed (${res.status})`), {
      status: res.status,
    });
  }
  return data;
}

export function siteDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Start a reading session. Prefer verbatimText from extract — never model rewrite. */
export async function createSession(
  args: {
    url: string;
    verbatimText?: string;
    title?: string;
    author?: string;
    siteName?: string;
    authorSource?: string;
    authorUnknown?: boolean;
  },
  meta: ClientMeta,
): Promise<SessionResponse> {
  const data = await postJson<SessionResponse>("session", {
    url: args.url,
    verbatimText: args.verbatimText || "",
    title: args.title || "",
    author: args.author || "",
    siteName: args.siteName || "",
    authorSource: args.authorSource || "",
    authorUnknown: Boolean(args.authorUnknown),
    anonymousId: meta.anonymousId,
    ...(meta.owner ? { owner: meta.owner } : {}),
  });
  if (data.voiceId === BANNED_VOICE_ID) {
    throw new Error("Refusing banned voice id");
  }
  return data;
}

export async function speakChunk(
  sessionId: string,
  fromWordIndex: number,
): Promise<SpeakResponse> {
  const data = await postJson<SpeakResponse>("speak", {
    sessionId,
    fromWordIndex,
  });
  if (data.voiceId === BANNED_VOICE_ID) {
    throw new Error("Refusing banned voice id");
  }
  return data;
}

export async function askQuestion(args: {
  sessionId: string;
  question: string;
  input: "voice" | "typed";
  wordIndex: number;
  anonymousId: string;
  rawTranscript?: string;
  owner?: "1";
}): Promise<AskResponse> {
  return postJson<AskResponse>("ask", {
    sessionId: args.sessionId,
    question: args.question,
    input: args.input,
    position: { wordIndex: args.wordIndex },
    anonymousId: args.anonymousId,
    rawTranscript: args.rawTranscript || "",
    ...(args.owner ? { owner: args.owner } : {}),
  });
}

export async function writeAudioCache(
  b64: string,
  contentType = "audio/mpeg",
): Promise<string> {
  if (!b64) return "";
  if (typeof document !== "undefined") {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: contentType || "audio/mpeg" });
    return URL.createObjectURL(blob);
  }
  const FileSystem = await import("expo-file-system/legacy");
  const ext = contentType.includes("wav") ? "wav" : "mp3";
  const base = FileSystem.cacheDirectory || FileSystem.documentDirectory || "";
  const uri = `${base}tinker-tts-${Date.now()}.${ext}`;
  await FileSystem.writeAsStringAsync(uri, b64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
}

/** Split verbatim text into short punchy display lines (lindowlabs essay feel). */
export function punchyLines(text: string): string[] {
  const paras = String(text || "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const lines: string[] = [];
  for (const para of paras) {
    // Keep short sentences as their own lines; break long ones near ~90 chars.
    const sentences = para.split(/(?<=[.!?])\s+/).filter(Boolean);
    for (const s of sentences) {
      if (s.length <= 110) {
        lines.push(s);
        continue;
      }
      let rest = s;
      while (rest.length > 110) {
        let cut = rest.lastIndexOf(" ", 90);
        if (cut < 40) cut = 90;
        lines.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) lines.push(rest);
    }
  }
  return lines;
}
