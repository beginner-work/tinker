import { API_BASE_URL, PLATFORM } from "./config";
import { BANNED_VOICE_ID } from "@/src/theme/tokens";

export type ClientMeta = {
  anonymousId: string;
  owner?: "1";
  platform?: string;
};

export type SessionResponse = {
  sessionId: string;
  sourceUrl: string;
  title: string;
  author: string;
  siteName?: string;
  wordCount: number;
  companyHost: string;
  voiceId: string;
  preview: string;
  attribution: string;
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
  linkedInUrl?: string;
  emailUrl?: string;
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
    const err = new Error(data.error || `Request failed (${res.status})`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
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

export async function createSession(
  url: string,
  meta: ClientMeta,
): Promise<SessionResponse> {
  const data = await postJson<SessionResponse>("session", {
    url,
    anonymousId: meta.anonymousId,
    ...(meta.owner ? { owner: meta.owner } : {}),
    platform: PLATFORM,
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
    platform: PLATFORM,
  });
}

export async function writeAudioCache(
  b64: string,
  contentType = "audio/mpeg",
): Promise<string> {
  if (!b64) return "";
  // Web: object URL from bytes.
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
