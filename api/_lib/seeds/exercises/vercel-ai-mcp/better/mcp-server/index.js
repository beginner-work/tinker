/**
 * TypeScript-friendly MCP server using @modelcontextprotocol/sdk over stdio.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const ORDERS = {
  ord_100: { id: "ord_100", status: "paid", amount_cents: 4200 },
  ord_200: { id: "ord_200", status: "refunded", amount_cents: 1500 },
};

const server = new Server(
  { name: "orders-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "lookup_order",
      description: "Look up an order by id",
      inputSchema: {
        type: "object",
        properties: { orderId: { type: "string" } },
        required: ["orderId"],
      },
    },
    {
      name: "search_docs",
      description: "Search help docs",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = req.params.arguments || {};
  let result;
  if (name === "lookup_order") {
    result = ORDERS[args.orderId] || { error: "not_found" };
  } else if (name === "search_docs") {
    result = {
      snippet: String(args.query || "").toLowerCase().includes("refund")
        ? "Refunds take 3 to 5 business days."
        : "No doc match.",
    };
  } else {
    throw new Error("unknown tool: " + name);
  }
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result,
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
