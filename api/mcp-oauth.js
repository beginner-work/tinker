/* MCP authorization server, one function.
 *
 * Rewrites in vercel.json send discovery, register, authorize, token,
 * and MCP access here. The browser page uses the existing tinker
 * sign-in. Approve gives the connector an mcp_ bearer. MCP access
 * lists and revokes those bearers, and can mint one shown once for a
 * client that cannot complete OAuth.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const {
  isMcpApiKey,
  listMcpKeys,
  mintMcpKey,
  revokeMcpKey,
  userIdFromSession,
} = require("./_lib/mcp-keys.js");
const {
  registerClient,
  parseAuthorizeParams,
  clientForAuthorize,
  decideAuthorization,
  exchangeCode,
} = require("./_lib/mcp-oauth.js");
const { publicOrigin, mcpResource } = require("./_lib/mcp-origin.js");

const ONCE = "Copy this credential now. It will not be shown again.";

function queryParams(req) {
  const out = {};
  try {
    const url = new URL(req.url || "/", "https://tinker.local");
    for (const [key, value] of url.searchParams) out[key] = value;
  } catch {
    /* ignore a malformed URL */
  }
  if (req.query && typeof req.query === "object") {
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") out[key] = value;
    }
  }
  return out;
}

function readBody(req) {
  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  const type = String(
    (req.headers && (req.headers["content-type"] || req.headers["Content-Type"])) || "",
  );
  if (typeof body === "string") {
    if (!body.trim()) return {};
    if (type.includes("application/x-www-form-urlencoded")) {
      return Object.fromEntries(new URLSearchParams(body));
    }
    try {
      body = JSON.parse(body);
    } catch {
      throw Object.assign(new Error("Invalid JSON"), {
        status: 400,
        oauthError: "invalid_request",
      });
    }
  }
  if (body == null) return {};
  if (typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("Invalid JSON"), {
      status: 400,
      oauthError: "invalid_request",
    });
  }
  return body;
}

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function publicKey(row) {
  return {
    id: row.id,
    label: row.label,
    createdAt: iso(row.createdAt),
    revokedAt: row.revokedAt ? iso(row.revokedAt) : null,
  };
}

function sendJson(res, status, body) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Content-Type", "application/json");
  res.status(status).json(body);
}

function sendHtml(res, status, html) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.status(status);
  if (typeof res.send === "function") res.send(html);
  else res.end(html);
}

function sendError(res, err) {
  const status = err.status || 500;
  if (err.oauthError) {
    sendJson(res, status, {
      error: err.oauthError,
      error_description: err.message,
    });
    return;
  }
  sendJson(res, status, { error: err.message || "Internal error" });
}

async function sessionUser(req) {
  const token = extractBearer(req.headers && req.headers.authorization);
  if (!token) {
    throw Object.assign(new Error("Sign in to tinker first."), { status: 401 });
  }
  if (isMcpApiKey(token)) {
    throw Object.assign(
      new Error("MCP credentials cannot manage access. Sign in to tinker."),
      { status: 401 },
    );
  }
  const session = await authenticateSession(token);
  const userId = userIdFromSession(session);
  if (!userId) {
    throw Object.assign(new Error("Session missing user id."), { status: 401 });
  }
  return userId;
}

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function embedJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function page(title, body, config) {
  const configTag = config
    ? `<script type="application/json" id="mcp-config">${embedJson(config)}</script>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(title)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font: 16px/1.45 Georgia, "Iowan Old Style", serif; background: #fffdf7; color: #1f1d1a; }
    main { max-width: 32rem; margin: 0 auto; padding: 48px 20px 64px; }
    h1 { font-size: 1.6rem; font-weight: 600; margin: 0 0 8px; }
    p { margin: 0 0 14px; }
    .muted { color: #5c574e; }
    button, .link { font: inherit; }
    button { margin: 8px 8px 0 0; padding: 10px 16px; border-radius: 10px; border: 0; background: #4f46e5; color: #fff; cursor: pointer; }
    button.ghost { background: transparent; color: #1f1d1a; border: 1px solid #d9d3c7; }
    a { color: #4f46e5; }
    input, code { font: 14px/1.4 ui-monospace, monospace; }
    input { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #d9d3c7; border-radius: 8px; background: #fff; }
    li { margin: 0 0 10px; }
    .row { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
    .error { color: #8f2d22; }
  </style>
</head>
<body>
  <main>
    ${configTag}
    <h1>${esc(title)}</h1>
    ${body}
  </main>
</body>
</html>`;
}

const SESSION_SCRIPT = `
function mcpToken() {
  try { return localStorage.getItem("tinker_jwt") || ""; }
  catch (e) { return ""; }
}
function mcpSendHome() {
  try { sessionStorage.setItem("tinker_mcp_return", location.pathname + location.search); }
  catch (e) {}
  location.assign("/");
}
function mcpClearToken() {
  try { localStorage.removeItem("tinker_jwt"); }
  catch (e) {}
}
function mcpTokenExpired(token) {
  var parts = String(token || "").split(".");
  if (parts.length !== 3) return false;
  try {
    var segment = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (segment.length % 4) segment += "=";
    var payload = JSON.parse(atob(segment));
    return typeof payload.exp === "number" && payload.exp * 1000 <= Date.now();
  } catch (e) {
    return false;
  }
}
function mcpRequireSignIn() {
  mcpClearToken();
  mcpSendHome();
}
function mcpConfig() {
  return JSON.parse(document.getElementById("mcp-config").textContent);
}
`.trim();

function authorizeHtml(clientName, approve) {
  const body = `
    <button id="mcp-approve" type="button">Approve</button>
    <p id="mcp-status" class="error" role="status"></p>
    <script>
      (function () {
      ${SESSION_SCRIPT}
      var token = mcpToken();
      if (!token || mcpTokenExpired(token)) { mcpRequireSignIn(); return; }
      var status = document.getElementById("mcp-status");
      document.getElementById("mcp-approve").addEventListener("click", function () {
        var cfg = mcpConfig();
        status.textContent = "Approving…";
        fetch("/mcp/authorize", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
          body: JSON.stringify(Object.assign({ decision: "approve" }, cfg.approve))
        }).then(function (res) {
          return res.json().then(function (body) {
            return { status: res.status, body: body };
          }, function () {
            return { status: res.status, body: null };
          });
        }).then(function (result) {
          if (result.status === 401) { mcpRequireSignIn(); return; }
          if (result.body && result.body.redirect) {
            location.assign(result.body.redirect);
            return;
          }
          status.textContent = (result.body && (result.body.error_description || result.body.error)) || "Could not finish.";
        }).catch(function () { status.textContent = "Could not finish."; });
      });
      })();
    </script>`;
  return page(`${clientName} wants to use tinker.`, body, { approve });
}

function accessHtml(resource) {
  const body = `
    <p class="muted">Connectors that can sign in only need the server URL. You approve them in tinker. Revoke a credential here and it stops on the next request.</p>
    <p><code id="mcp-resource"></code></p>
    <ul id="mcp-list"></ul>
    <h2>A client that cannot sign in</h2>
    <p class="muted">If the connector has nowhere to send you and only accepts an Authorization header, create a credential here. It is shown once.</p>
    <input id="mcp-label" type="text" maxlength="80" placeholder="Label, such as notebook" autocomplete="off">
    <button id="mcp-mint" type="button">Create a credential</button>
    <div id="mcp-reveal" hidden>
      <p id="mcp-note"></p>
      <input id="mcp-key" type="text" readonly>
    </div>
    <p id="mcp-status" class="error" role="status"></p>
    <script>
      (function () {
      ${SESSION_SCRIPT}
      var token = mcpToken();
      if (!token) { mcpSendHome(); return; }
      var resource = mcpConfig().resource;
      document.getElementById("mcp-resource").textContent = resource;
      var status = document.getElementById("mcp-status");
      var list = document.getElementById("mcp-list");
      function authHeaders() {
        return { "Authorization": "Bearer " + token, "Content-Type": "application/json" };
      }
      function showError(body) {
        status.textContent = (body && body.error) || "Could not load MCP access.";
      }
      function render(keys) {
        list.replaceChildren();
        keys.forEach(function (row) {
          var item = document.createElement("li");
          var label = document.createElement("div");
          label.className = "row";
          var name = document.createElement("span");
          var when = row.revokedAt ? "Revoked" : "Active";
          name.textContent = row.label + " (" + when + ")";
          label.appendChild(name);
          if (!row.revokedAt) {
            var button = document.createElement("button");
            button.type = "button";
            button.className = "ghost";
            button.textContent = "Revoke";
            button.addEventListener("click", function () { revoke(row.id, button); });
            label.appendChild(button);
          }
          item.appendChild(label);
          list.appendChild(item);
        });
        if (!keys.length) {
          var empty = document.createElement("li");
          empty.textContent = "No credentials yet.";
          list.appendChild(empty);
        }
      }
      function load() {
        return fetch("/mcp/access?format=json", { headers: authHeaders() })
          .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
          .then(function (result) {
            if (!result.ok) { showError(result.body); return; }
            render(result.body.keys || []);
          })
          .catch(function () { status.textContent = "Could not load MCP access."; });
      }
      function revoke(id, button) {
        button.disabled = true;
        fetch("/mcp/access", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ action: "revoke", id: id })
        }).then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
          .then(function (result) {
            if (!result.ok) { showError(result.body); button.disabled = false; return; }
            return load();
          })
          .catch(function () { status.textContent = "Could not revoke."; button.disabled = false; });
      }
      document.getElementById("mcp-mint").addEventListener("click", function () {
        var label = document.getElementById("mcp-label").value.trim();
        status.textContent = "";
        fetch("/mcp/access", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ action: "mint", label: label })
        }).then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
          .then(function (result) {
            if (!result.ok) { showError(result.body); return; }
            document.getElementById("mcp-reveal").hidden = false;
            document.getElementById("mcp-note").textContent = result.body.note || "";
            document.getElementById("mcp-key").value = result.body.key || "";
            document.getElementById("mcp-label").value = "";
            return load();
          })
          .catch(function () { status.textContent = "Could not create a credential."; });
      });
      load();
      })();
    </script>`;
  return page("MCP access", body, { resource });
}

function errorHtml(message) {
  return page("MCP access", `<p class="error">${esc(message)}</p>`);
}

function metadata(req, kind) {
  const origin = publicOrigin(req);
  const resource = mcpResource(req);
  if (kind === "resource") {
    return {
      resource,
      authorization_servers: [origin],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp"],
      resource_name: "tinker",
    };
  }
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/mcp/authorize`,
    token_endpoint: `${origin}/mcp/token`,
    registration_endpoint: `${origin}/mcp/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Accept, MCP-Protocol-Version",
    );
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).end();
    return;
  }

  const params = queryParams(req);
  const op = params.op || "";

  try {
    if (op === "resource" || op === "as") {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }
      sendJson(res, 200, metadata(req, op));
      return;
    }

    if (op === "register") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }
      const created = await registerClient(readBody(req));
      sendJson(res, 201, created);
      return;
    }

    if (op === "authorize") {
      const origin = publicOrigin(req);
      if (req.method === "GET") {
        const parsed = parseAuthorizeParams(params, origin);
        const client = await clientForAuthorize(parsed);
        const approve = {
          response_type: "code",
          client_id: parsed.clientId,
          redirect_uri: parsed.redirectUri,
          code_challenge: parsed.codeChallenge,
          code_challenge_method: "S256",
          resource: parsed.resource,
          state: parsed.state,
        };
        if (params.scope) approve.scope = parsed.scope;
        sendHtml(res, 200, authorizeHtml(client.clientName, approve));
        return;
      }
      if (req.method !== "POST") {
        res.setHeader("Allow", "GET, POST");
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }
      const body = readBody(req);
      const userId = await sessionUser(req);
      const decision = body.decision === "deny" ? "deny" : "approve";
      const parsed = parseAuthorizeParams(body, origin);
      const result = await decideAuthorization({ userId, decision, params: parsed });
      sendJson(res, 200, { redirect: result.redirect });
      return;
    }

    if (op === "token") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }
      const issued = await exchangeCode({
        origin: publicOrigin(req),
        body: readBody(req),
      });
      sendJson(res, 200, issued);
      return;
    }

    if (op === "access") {
      const resource = mcpResource(req);
      const wantsJson = params.format === "json";
      if (req.method === "GET" && !wantsJson) {
        sendHtml(res, 200, accessHtml(resource));
        return;
      }
      const userId = await sessionUser(req);
      if (req.method === "GET") {
        const keys = await listMcpKeys(userId);
        sendJson(res, 200, { resource, keys: keys.map(publicKey) });
        return;
      }
      if (req.method !== "POST") {
        res.setHeader("Allow", "GET, POST");
        sendJson(res, 405, { error: "Method not allowed" });
        return;
      }
      const body = readBody(req);
      if (body.action === "mint") {
        const minted = await mintMcpKey({ label: body.label, userId });
        sendJson(res, 200, {
          id: minted.id,
          label: minted.label,
          createdAt: iso(minted.createdAt),
          key: minted.key,
          note: ONCE,
        });
        return;
      }
      if (body.action === "revoke") {
        const revoked = await revokeMcpKey(body.id, userId);
        sendJson(res, 200, publicKey(revoked));
        return;
      }
      sendJson(res, 400, { error: "action must be mint or revoke." });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    if (op === "authorize" && req.method === "GET") {
      sendHtml(res, err.status || 400, errorHtml(err.message || "Could not start approval."));
      return;
    }
    sendError(res, err);
  }
};
