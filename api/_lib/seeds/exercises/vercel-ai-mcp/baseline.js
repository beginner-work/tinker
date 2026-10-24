/**
 * Baseline: AI SDK-shaped agent + MCP-shaped tools, but a global mutex.
 * Only one request runs at a time. Under concurrent load, wait times explode.
 *
 * Stub LLM and in-process tools. No network. No API keys.
 */

const ORDERS = {
  ord_100: { id: "ord_100", status: "paid", amount_cents: 4200 },
  ord_200: { id: "ord_200", status: "refunded", amount_cents: 1500 },
};

/** MCP-shaped tool list / call (in-process stand-in). */
const mcpTools = {
  async listTools() {
    return ["lookup_order", "search_docs"];
  },
  async callTool(name, args) {
    await sleep(25);
    if (name === "lookup_order") return ORDERS[args.orderId] || { error: "not_found" };
    if (name === "search_docs") {
      return {
        snippet: String(args.query || "").toLowerCase().includes("refund")
          ? "Refunds take 3 to 5 business days."
          : "No doc match.",
      };
    }
    throw new Error("unknown tool: " + name);
  },
};

/** Stub "model": pick a tool from the prompt (AI SDK generateText stand-in). */
export function chooseTool(prompt) {
  const order = String(prompt).match(/\bord_[a-z0-9]+\b/i);
  if (order) return { name: "lookup_order", args: { orderId: order[0] } };
  return { name: "search_docs", args: { query: String(prompt) } };
}

let chain = Promise.resolve();

export async function runAgent(prompt) {
  const run = chain.then(async () => {
    await sleep(15); // stub model think
    const pick = chooseTool(prompt);
    const toolResult = await mcpTools.callTool(pick.name, pick.args);
    return { tool: pick.name, toolResult, mode: "serial" };
  });
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export async function runMany(prompts) {
  const t0 = performance.now();
  const results = [];
  for (const prompt of prompts) {
    results.push(await runAgent(prompt));
  }
  return { results, ms: performance.now() - t0, mode: "serial" };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
