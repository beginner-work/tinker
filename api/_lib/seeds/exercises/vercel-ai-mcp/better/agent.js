/**
 * Better agent: Vercel AI SDK tool loop shape + MCP SDK tools.
 * Uses a stub model unless ANTHROPIC_API_KEY is set.
 */
import { generateText, tool } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { connectMcp } from "./mcp-client.js";

async function stubGenerate({ prompt, tools }) {
  await new Promise((r) => setTimeout(r, 20));
  const orderMatch = String(prompt).match(/\bord_[a-z0-9]+\b/i);
  const name = orderMatch ? "lookup_order" : "search_docs";
  const args = orderMatch
    ? { orderId: orderMatch[0] }
    : { query: String(prompt) };
  const result = await tools[name].execute(args);
  return {
    text: `Used ${name}`,
    tool: name,
    toolResult: result,
    provider: "stub",
  };
}

export async function runAgent(prompt) {
  const mcp = await connectMcp();
  try {
    const tools = {
      lookup_order: tool({
        description: "Look up an order by id",
        parameters: z.object({ orderId: z.string() }),
        execute: async ({ orderId }) => mcp.callTool("lookup_order", { orderId }),
      }),
      search_docs: tool({
        description: "Search help docs",
        parameters: z.object({ query: z.string() }),
        execute: async ({ query }) => mcp.callTool("search_docs", { query }),
      }),
    };

    if (!process.env.ANTHROPIC_API_KEY) {
      return stubGenerate({ prompt, tools });
    }

    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const result = await generateText({
      model: anthropic("claude-3-5-haiku-latest"),
      prompt: String(prompt),
      tools,
      maxSteps: 2,
    });
    return {
      text: result.text,
      tool: result.toolCalls?.[0]?.toolName || null,
      toolResult: result.toolResults?.[0]?.result,
      provider: "anthropic",
    };
  } finally {
    await mcp.close();
  }
}
