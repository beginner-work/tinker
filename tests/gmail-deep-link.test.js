/* Public /gmail deep-link: encoding round-trip + validation (fake data only). */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const gmail = require("../api/_lib/gmail-deep-link.js");
const handler = require("../api/gmail.js");

test("encoding round-trip covers newlines, &, ', #, and emoji", () => {
  const fields = {
    to: "test.user+tag@example.com",
    cc: "cc.friend@example.com",
    bcc: "bcc.quiet@example.com",
    subject: "Hi & hello — let's talk #1",
    body: "Line1\nLine2 & more\nDon't forget 🚀\nSee #notes",
  };

  const app = gmail.buildAppUrl(fields);
  assert.match(app, /^googlegmail:\/\/co\?/);
  const appQs = app.slice("googlegmail://co?".length);
  const appParams = new URLSearchParams(appQs);
  assert.equal(appParams.get("to"), fields.to);
  assert.equal(appParams.get("cc"), fields.cc);
  assert.equal(appParams.get("bcc"), fields.bcc);
  assert.equal(appParams.get("subject"), fields.subject);
  assert.equal(appParams.get("body"), fields.body);
  // encodeURIComponent form (not + for spaces) — &, ', #, emoji survive.
  assert.match(app, /subject=Hi%20%26%20hello/);
  assert.match(app, /body=Line1%0ALine2/);
  assert.ok(app.includes(encodeURIComponent("Don't")));
  assert.ok(app.includes(encodeURIComponent("#1")));
  assert.ok(app.includes(encodeURIComponent("🚀")));

  const web = gmail.buildWebUrl(fields);
  assert.match(web, /^https:\/\/mail\.google\.com\/mail\/\?/);
  const webParams = new URL(web).searchParams;
  assert.equal(webParams.get("view"), "cm");
  assert.equal(webParams.get("fs"), "1");
  assert.equal(webParams.get("authuser"), gmail.GMAIL_AUTHUSER);
  assert.equal(webParams.get("to"), fields.to);
  assert.equal(webParams.get("cc"), fields.cc);
  assert.equal(webParams.get("bcc"), fields.bcc);
  assert.equal(webParams.get("su"), fields.subject);
  assert.equal(webParams.get("body"), fields.body);
});

test("authuser is a single config constant, not scattered literals", () => {
  assert.equal(gmail.GMAIL_AUTHUSER, "tyler@lindowlabs.dev");
  const api = fs.readFileSync(path.join(__dirname, "../api/gmail.js"), "utf8");
  const lib = fs.readFileSync(path.join(__dirname, "../api/_lib/gmail-deep-link.js"), "utf8");
  assert.match(api, /GMAIL_AUTHUSER/);
  assert.equal(/tyler@lindowlabs\.dev/.test(api), false, "handler must not hard-code authuser");
  assert.equal((lib.match(/tyler@lindowlabs\.dev/g) || []).length, 1);
});

test("parseGmailFields validates to and caps body near 8000 chars", () => {
  assert.equal(gmail.parseGmailFields({}).ok, false);
  assert.equal(gmail.parseGmailFields({ to: "not-an-email" }).ok, false);
  assert.equal(gmail.parseGmailFields({ to: "ok@example.com<script>" }).ok, false);

  const ok = gmail.parseGmailFields({
    to: "ok@example.com",
    subject: "Hi",
    body: "x".repeat(9000),
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.fields.body.length, gmail.MAX_BODY);
  assert.equal(gmail.MAX_BODY, 8000);

  const multi = gmail.parseGmailFields({ to: "a@example.com, b@example.com" });
  assert.equal(multi.ok, true);
});

test("escapeHtml prevents XSS in displayed fields", () => {
  assert.equal(
    gmail.escapeHtml(`<img src=x onerror=alert(1)> & '"`),
    "&lt;img src=x onerror=alert(1)&gt; &amp; &#39;&quot;"
  );
});

test("GET /gmail handler returns escaped page with deep link (fake data)", async () => {
  const body = "Line1\nLine2 & 'quotes' #tag 🚀";
  const query = {
    to: "test@example.com",
    subject: "Hi & hello",
    body,
  };
  const { status, html } = await invoke(query);
  assert.equal(status, 200);
  assert.match(html, /Open in Gmail/);
  assert.match(html, /test@example\.com/);
  assert.match(html, /Hi &amp; hello/);
  assert.equal(/<img src=x/.test(html), false);
  const appUrl = gmail.buildAppUrl(gmail.parseGmailFields(query).fields);
  assert.ok(html.includes(gmail.escapeHtml(appUrl)));
  assert.ok(html.includes("window.location"));
  assert.ok(html.includes(JSON.stringify(appUrl)));
  assert.match(html, /mail\.google\.com\/mail\/\?/);
  assert.match(html, /authuser=tyler%40lindowlabs\.dev/);
});

test("vercel rewrites /gmail to the public handler", () => {
  const vercel = fs.readFileSync(path.join(__dirname, "../vercel.json"), "utf8");
  assert.match(vercel, /"source":\s*"\/gmail"/);
  assert.match(vercel, /"destination":\s*"\/api\/gmail"/);
});

function invoke(query) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      req.query = query;
      Promise.resolve(handler(req, res)).catch(reject);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      http.get({ host: "127.0.0.1", port, path: "/gmail" }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode, html: Buffer.concat(chunks).toString("utf8") });
        });
      }).on("error", (err) => {
        server.close();
        reject(err);
      });
    });
  });
}
