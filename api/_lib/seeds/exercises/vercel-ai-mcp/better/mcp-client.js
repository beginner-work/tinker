import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function connectMcp() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(here, "mcp-server/index.js")],
  });
  const client = new Client({ name: "scale-agent", version: "1.0.0" });
  await client.connect(transport);
  return {
    async listTools() {
      const listed = await client.listTools();
      return (listed.tools || []).map((t) => t.name);
    },
    async callTool(name, args) {
      const result = await client.callTool({ name, arguments: args || {} });
      if (result.structuredContent) return result.structuredContent;
      const text = result.content?.[0]?.text;
      try {
        return JSON.parse(text);
      } catch {
        return { text };
      }
    },
    async close() {
      await client.close();
    },
  };
}
