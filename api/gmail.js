/* GET /gmail?to=&subject=&body=&cc=&bcc=
 *
 * Public, login-free redirect page. Builds a googlegmail:// deep link and a
 * mail.google.com fallback. Stateless: no storage, no logging of query data.
 */

"use strict";

const {
  GMAIL_AUTHUSER,
  escapeHtml,
  parseGmailFields,
  buildAppUrl,
  buildWebUrl,
} = require("./_lib/gmail-deep-link.js");

function sendHtml(res, status, html) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.end(html);
}

function errorPage(message) {
  const safe = escapeHtml(message || "Invalid request.");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Open in Gmail</title>
  <link rel="stylesheet" href="/design-tokens.css" />
  <link rel="stylesheet" href="/styles.css" />
  <style>
    body.gmail-open {
      margin: 0;
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-background, #fffdf7);
      color: var(--color-foreground, #2d2a26);
      font-family: var(--font-sans, system-ui, sans-serif);
      padding: 24px;
    }
    .gmail-open__card { max-width: 28rem; width: 100%; text-align: center; }
    .gmail-open__title {
      margin: 0 0 12px;
      font-family: var(--font-display, inherit);
      font-size: 28px;
      letter-spacing: -0.02em;
    }
    .gmail-open__err { color: var(--color-muted, #6f6a65); font-size: 15px; line-height: 1.45; }
  </style>
</head>
<body class="gmail-open">
  <main class="gmail-open__card">
    <h1 class="gmail-open__title">Open in Gmail</h1>
    <p class="gmail-open__err">${safe}</p>
  </main>
</body>
</html>`;
}

function successPage(fields) {
  const appUrl = buildAppUrl(fields);
  const webUrl = buildWebUrl(fields, GMAIL_AUTHUSER);
  const safeAppHref = escapeHtml(appUrl);
  const safeWebHref = escapeHtml(webUrl);
  // JS string literal for location assign — escape backslash, quote, newlines.
  const jsAppUrl = JSON.stringify(appUrl);
  const toLabel = escapeHtml(fields.to);
  const subjectLabel = escapeHtml(fields.subject || "(no subject)");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Open in Gmail</title>
  <link rel="stylesheet" href="/design-tokens.css" />
  <link rel="stylesheet" href="/styles.css" />
  <style>
    body.gmail-open {
      margin: 0;
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-background, #fffdf7);
      color: var(--color-foreground, #2d2a26);
      font-family: var(--font-sans, system-ui, sans-serif);
      padding: 24px;
      padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
    }
    .gmail-open__card {
      max-width: 28rem;
      width: 100%;
      text-align: center;
    }
    .gmail-open__title {
      margin: 0 0 20px;
      font-family: var(--font-display, inherit);
      font-size: 28px;
      letter-spacing: -0.02em;
    }
    .gmail-open__meta {
      margin: 0 0 28px;
      text-align: left;
      font-size: 15px;
      line-height: 1.45;
      color: var(--color-foreground, #2d2a26);
    }
    .gmail-open__meta dt {
      margin: 0 0 2px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--color-muted, #6f6a65);
    }
    .gmail-open__meta dd {
      margin: 0 0 14px;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .gmail-open__cta {
      display: block;
      box-sizing: border-box;
      width: 100%;
      min-height: 52px;
      padding: 14px 18px;
      border-radius: 12px;
      background: var(--color-accent-strong, #6366f1);
      color: #fff;
      font-size: 17px;
      font-weight: 600;
      text-decoration: none;
      line-height: 1.2;
    }
    .gmail-open__cta:hover { filter: brightness(1.05); }
    .gmail-open__fallback {
      display: inline-block;
      margin-top: 18px;
      font-size: 14px;
      color: var(--color-muted, #6f6a65);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .gmail-open__fallback:hover { color: var(--color-foreground, #2d2a26); }
  </style>
</head>
<body class="gmail-open">
  <main class="gmail-open__card">
    <h1 class="gmail-open__title">Open in Gmail</h1>
    <dl class="gmail-open__meta">
      <dt>To</dt>
      <dd>${toLabel}</dd>
      <dt>Subject</dt>
      <dd>${subjectLabel}</dd>
    </dl>
    <a class="gmail-open__cta" id="gmail-app" href="${safeAppHref}">Open in Gmail</a>
    <a class="gmail-open__fallback" id="gmail-web" href="${safeWebHref}">Open in browser instead</a>
  </main>
  <script>
    (function () {
      try { window.location = ${jsAppUrl}; } catch (e) { /* ignore */ }
    })();
  </script>
</body>
</html>`;
}

module.exports = function handler(req, res) {
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.end("Method Not Allowed");
    return;
  }

  const parsed = parseGmailFields(req.query || {});
  if (!parsed.ok) {
    sendHtml(res, 400, errorPage(parsed.error));
    return;
  }

  sendHtml(res, 200, successPage(parsed.fields));
};
