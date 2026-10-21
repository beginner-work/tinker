"use strict";

/**
 * Thin HTTP client for the Tinker API. Never logs Authorization headers
 * or token values.
 */

function joinUrl(base, pathname) {
  const root = String(base || "").replace(/\/+$/, "");
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return root + path;
}

async function request(config, { method = "GET", path, body, headers } = {}) {
  const url = joinUrl(config.apiBaseUrl, path);
  const init = {
    method,
    headers: {
      Accept: "application/json",
      ...(headers || {}),
    },
  };
  if (config.token) {
    init.headers.Authorization = `Bearer ${config.token}`;
  }
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const msg = (err && err.message) || "Network error";
    throw Object.assign(new Error(`Could not reach ${config.apiBaseUrl}: ${msg}`), {
      code: "network_error",
    });
  }
  let json = null;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text.slice(0, 200) };
    }
  }
  return { ok: res.ok, status: res.status, json: json || {}, url };
}

async function converse(config, payload) {
  const result = await request(config, {
    method: "POST",
    path: "/api/claude/converse",
    body: payload,
  });
  if (!result.ok) {
    const errMsg =
      (result.json && result.json.error) ||
      (result.status === 401
        ? "Session expired. Run: tinker login"
        : `Claude request failed (${result.status})`);
    throw Object.assign(new Error(errMsg), {
      status: result.status,
      code: result.json && result.json.code,
    });
  }
  return result.json;
}

async function saveNotionEssay(config, essay) {
  const result = await request(config, {
    method: "POST",
    path: "/api/notion-essays",
    body: {
      title: essay.title,
      body: essay.body,
      date: essay.date || Date.now(),
      learningGoal: essay.learningGoal || "",
      exercise: essay.exercise || "",
    },
  });
  if (result.ok) {
    return { ok: true, page: result.json && result.json.page };
  }
  const code = result.json && result.json.code;
  let message =
    (result.json && result.json.error) || "Could not save this essay to Notion.";
  if (code === "notion_parent_required") {
    message =
      "Notion needs a parent page. Run: tinker login --notion  (then paste a page URL in Connections, or share the page with Tinker during authorize).";
  } else if (code === "notion_not_connected") {
    message = "Notion is not connected. Run: tinker login --notion";
  } else if (result.status === 401) {
    message = "Session expired. Run: tinker login";
  }
  return { ok: false, status: result.status, code, message };
}

async function requestPhoneOtp(config, phone) {
  const result = await request(config, {
    method: "POST",
    path: "/api/auth/phone/request",
    body: { phone },
  });
  if (!result.ok) {
    throw Object.assign(
      new Error((result.json && result.json.error) || "Could not send login code."),
      { status: result.status }
    );
  }
  return result.json;
}

async function verifyPhoneOtp(config, { phone_id, pin }) {
  const result = await request(config, {
    method: "POST",
    path: "/api/auth/phone/verify",
    body: { phone_id, pin },
  });
  if (!result.ok) {
    throw Object.assign(
      new Error((result.json && result.json.error) || "Could not verify login code."),
      { status: result.status }
    );
  }
  return result.json;
}

async function notionConnect(config) {
  const result = await request(config, {
    method: "POST",
    path: "/api/notion-oauth?action=connect",
    body: {},
  });
  if (!result.ok) {
    throw Object.assign(
      new Error((result.json && result.json.error) || "Could not start Notion connect."),
      { status: result.status, code: result.json && result.json.code }
    );
  }
  return result.json;
}

async function notionStatus(config) {
  const result = await request(config, {
    method: "GET",
    path: "/api/notion-oauth",
  });
  if (!result.ok) {
    return { connected: false, configured: false };
  }
  return result.json || {};
}

module.exports = {
  request,
  converse,
  saveNotionEssay,
  requestPhoneOtp,
  verifyPhoneOtp,
  notionConnect,
  notionStatus,
};
