/* Assistant — Claude via /api/claude/converse (Stytch-gated). */

import { api } from "../api/client";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AssistantRequest = {
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  model?: string;
};

export type AssistantReply = {
  text: string;
  provider: "claude";
};

export async function generate(
  req: AssistantRequest,
): Promise<AssistantReply> {
  const r = await api<{ text: string }>("/api/claude/converse", {
    method: "POST",
    body: {
      system: req.system,
      messages: req.messages,
      model: req.model || "claude-opus-4-7",
      maxTokens: req.maxTokens ?? 2048,
    },
  });
  return { text: (r.text || "").trim(), provider: "claude" };
}
