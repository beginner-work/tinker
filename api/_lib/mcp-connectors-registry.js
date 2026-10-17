/* Registry of outbound MCP servers Tinker can connect to as a client.
 *
 * Separate from Tinker's own MCP server (api/mcp.js), which bots call.
 * Add a row here to offer another connector in the Connections UI.
 */

"use strict";

/** @typedef {"oauth"} McpConnectorAuthType */

/**
 * @typedef {object} McpConnector
 * @property {string} id
 * @property {string} name
 * @property {string} url Streamable HTTP MCP endpoint
 * @property {McpConnectorAuthType} authType
 * @property {string[]} defaultReadTools Tool names enabled without write access
 * @property {string} description Short UI copy
 */

/** @type {McpConnector[]} */
const CONNECTORS = [
  {
    id: "notion",
    name: "Notion",
    url: "https://mcp.notion.com/mcp",
    authType: "oauth",
    defaultReadTools: ["notion-search", "notion-fetch"],
    description: "Search and fetch pages from your Notion workspace.",
  },
  {
    id: "github",
    name: "GitHub",
    url: "https://api.githubcopilot.com/mcp",
    authType: "oauth",
    defaultReadTools: ["get_me", "search_repositories", "get_file_contents"],
    description: "Read repos and files from your GitHub account.",
  },
];

function listConnectors() {
  return CONNECTORS.map((c) => Object.assign({}, c, {
    defaultReadTools: c.defaultReadTools.slice(),
  }));
}

function getConnector(id) {
  const key = String(id || "").trim().toLowerCase();
  const found = CONNECTORS.find((c) => c.id === key);
  if (!found) return null;
  return Object.assign({}, found, {
    defaultReadTools: found.defaultReadTools.slice(),
  });
}

module.exports = {
  CONNECTORS,
  listConnectors,
  getConnector,
};
