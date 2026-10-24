/**
 * Naive agent loop. Uses AI SDK-style tool definitions. MCP is called
 * in-process (no queue, no cache). A stub "model" picks tools so the
 * exercise runs without an API key.
 */
import { createMcpClient } from "./mcp-inline.js";

export async function runAgent(prompt) {
  const mcp = await createMcpClient();
  try {
    // Simulated model think time
    await new Promise((r) => setTimeout(r, 30));
    const tools = await mcp.listTools();
    const orderMatch = String(prompt).match(/\bord_[a-z0-9]+\b/i);
    const toolName = orderMatch ? "lookup_order" : "search_docs";
    if (!tools.includes(toolName)) throw new Error("missing tool " + toolName);
    const args = orderMatch
      ? { orderId: orderMatch[0] }
      : { query: String(prompt) };
    // Simulated MCP round trip
    await new Promise((r) => setTimeout(r, 40));
    const toolResult = await mcp.callTool(toolName, args);
    return {
      tool: toolName,
      toolResult,
      text: `Used ${toolName} via MCP`,
      provider: process.env.ANTHROPIC_API_KEY ? "anthropic" : "stub",
    };
  } finally {
    await mcp.close();
  }
}
