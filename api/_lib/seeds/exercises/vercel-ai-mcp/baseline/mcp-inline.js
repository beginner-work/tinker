/** Minimal in-process MCP stand-in for the baseline (no @modelcontextprotocol yet). */
const ORDERS = {
  ord_100: { id: "ord_100", status: "paid", amount_cents: 4200 },
  ord_200: { id: "ord_200", status: "refunded", amount_cents: 1500 },
};

export async function createMcpClient() {
  return {
    async listTools() {
      return ["lookup_order", "search_docs"];
    },
    async callTool(name, args) {
      if (name === "lookup_order") return ORDERS[args.orderId] || { error: "not_found" };
      if (name === "search_docs") {
        return {
          snippet: String(args.query || "").toLowerCase().includes("refund")
            ? "Refunds take 3 to 5 business days."
            : "No doc match.",
        };
      }
      throw new Error("unknown tool");
    },
    async close() {},
  };
}
