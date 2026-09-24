/* Public origin for MCP OAuth discovery.
 *
 * Preview and production both advertise the host the client actually
 * called, so the resource URL matches the URL the connector saved.
 */

"use strict";

function header(req, name) {
  const headers = (req && req.headers) || {};
  const value = headers[name] || headers[name.toLowerCase()] || "";
  return String(value).split(",")[0].trim();
}

function publicOrigin(req) {
  const host = header(req, "x-forwarded-host") || header(req, "host") || "tinker.beginner.work";
  let proto = header(req, "x-forwarded-proto");
  if (!proto) {
    proto = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  }
  return `${proto}://${host}`;
}

function mcpResource(req) {
  return `${publicOrigin(req)}/api/mcp`;
}

function resourceMetadataUrl(req) {
  return `${publicOrigin(req)}/.well-known/oauth-protected-resource/api/mcp`;
}

function wwwAuthenticate(req) {
  return `Bearer resource_metadata="${resourceMetadataUrl(req)}"`;
}

module.exports = {
  publicOrigin,
  mcpResource,
  resourceMetadataUrl,
  wwwAuthenticate,
};
