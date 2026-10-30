/** Shared request/response shapes for Tinker embed endpoints. */

export type AskInputType = "voice" | "typed";

export interface TalkPosition {
  wordIndex?: number;
  timestampMs?: number;
  paragraph?: number | string;
}

export interface TranscribeResult {
  text: string;
  words: Array<{
    text: string;
    start: number | null;
    end: number | null;
    type?: string;
  }>;
  durationMs: number | null;
  requestId: string;
}

export interface AskRequestBody {
  question: string;
  input: AskInputType;
  rawTranscript?: string;
  position?: TalkPosition;
  sourceId: string;
  context?: string | Record<string, unknown>;
}

export interface AskResult {
  answerText: string;
  /** Base64 MP3 (no data: prefix). */
  audio: string;
  requestId: string;
  latencyMs: number;
  label?: string;
}

export interface TinkerErrorBody {
  error?: string;
  requestId?: string;
}
