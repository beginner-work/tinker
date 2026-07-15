/* Assistant abstraction — one call surface, two providers.
 *
 *   1. Gemini Nano on-device (Android with AICore, via the local
 *      modules/gemini-nano Expo module wrapping ML Kit's GenAI Prompt
 *      API). Free, private, works offline.
 *   2. Claude through the existing /api/claude/converse proxy (the same
 *      Stytch-gated endpoint the web renderer uses). Server-side key,
 *      always available when signed in.
 *
 * The interview flow calls generate() and doesn't care which provider
 * answered. On-device is preferred when the model is AVAILABLE and the
 * request fits its limits; anything else falls through to Claude.
 */

import { Platform } from "react-native";
import { api } from "../api/client";
import * as GeminiNano from "../../modules/gemini-nano";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AssistantRequest = {
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  model?: string;
};

export type AssistantReply = {
  text: string;
  provider: "gemini-nano" | "claude";
};

export type OnDevicePreference = "auto" | "never";

let preference: OnDevicePreference = "auto";
export function setOnDevicePreference(p: OnDevicePreference) {
  preference = p;
}

export async function onDeviceStatus(): Promise<GeminiNano.NanoAvailability> {
  if (Platform.OS !== "android") return "unsupported";
  return GeminiNano.availability();
}

/* Gemini Nano's context window is small compared to Claude's. Keep a
 * conservative character budget and fall back to Claude for anything
 * bigger rather than truncating the founder's words. */
const NANO_MAX_INPUT_CHARS = 8000;

function flattenForNano(req: AssistantRequest): string {
  const parts: string[] = [];
  if (req.system) parts.push(req.system);
  for (const m of req.messages) {
    parts.push(m.role === "user" ? `USER:\n${m.content}` : `ASSISTANT:\n${m.content}`);
  }
  parts.push("ASSISTANT:");
  return parts.join("\n\n");
}

async function generateOnDevice(req: AssistantRequest): Promise<AssistantReply | null> {
  if (Platform.OS !== "android" || preference === "never") return null;
  const status = await GeminiNano.availability();
  if (status !== "available") return null;
  const prompt = flattenForNano(req);
  if (prompt.length > NANO_MAX_INPUT_CHARS) return null;
  try {
    const text = await GeminiNano.generate(prompt, {
      maxOutputTokens: req.maxTokens ?? 1024,
      temperature: 0.4,
    });
    if (!text || !text.trim()) return null;
    return { text: text.trim(), provider: "gemini-nano" };
  } catch {
    // On-device inference failed (thermal limits, model eviction, …) —
    // the server path below still answers.
    return null;
  }
}

async function generateViaClaude(req: AssistantRequest): Promise<AssistantReply> {
  const r = await api<{ text: string }>("/api/claude/converse", {
    method: "POST",
    body: {
      system: req.system,
      messages: req.messages,
      model: req.model || "claude-opus-4-8",
      maxTokens: req.maxTokens ?? 2048,
    },
  });
  return { text: (r.text || "").trim(), provider: "claude" };
}

export async function generate(req: AssistantRequest): Promise<AssistantReply> {
  const onDevice = await generateOnDevice(req);
  if (onDevice) return onDevice;
  return generateViaClaude(req);
}
