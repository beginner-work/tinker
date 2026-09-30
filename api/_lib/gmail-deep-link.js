/* Stateless builders for the public /gmail deep-link page.
 * No I/O, no logging, no storage — query in, URLs out.
 */

"use strict";

/** Fallback web compose account (single config constant). */
const GMAIL_AUTHUSER = "tyler@lindowlabs.dev";

const MAX_TO = 500;
const MAX_CC = 500;
const MAX_BCC = 500;
const MAX_SUBJECT = 500;
const MAX_BODY = 8000;

// One or more comma/semicolon-separated addresses; each must look like email.
const EMAIL_ONE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function clip(value, max) {
  const s = value == null ? "" : String(value);
  return s.length > max ? s.slice(0, max) : s;
}

function splitAddresses(raw) {
  return String(raw || "")
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function looksLikeEmails(raw) {
  const parts = splitAddresses(raw);
  if (!parts.length) return false;
  return parts.every((addr) => EMAIL_ONE.test(addr));
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Parse and validate query fields. Returns { ok, error?, fields }.
 * `to` is required and must look like email address(es).
 */
function parseGmailFields(query) {
  const src = query && typeof query === "object" ? query : {};
  const to = clip(src.to, MAX_TO).trim();
  const subject = clip(src.subject, MAX_SUBJECT);
  const body = clip(src.body, MAX_BODY);
  const cc = clip(src.cc, MAX_CC).trim();
  const bcc = clip(src.bcc, MAX_BCC).trim();

  if (!to) {
    return { ok: false, error: "Missing to address.", fields: null };
  }
  if (!looksLikeEmails(to)) {
    return { ok: false, error: "to must look like an email address.", fields: null };
  }
  if (cc && !looksLikeEmails(cc)) {
    return { ok: false, error: "cc must look like an email address.", fields: null };
  }
  if (bcc && !looksLikeEmails(bcc)) {
    return { ok: false, error: "bcc must look like an email address.", fields: null };
  }

  return {
    ok: true,
    error: null,
    fields: { to, subject, body, cc, bcc },
  };
}

/** googlegmail://co?... with each value encodeURIComponent'd. */
function buildAppUrl(fields) {
  const f = fields || {};
  const parts = [];
  if (f.to) parts.push("to=" + encodeURIComponent(f.to));
  if (f.cc) parts.push("cc=" + encodeURIComponent(f.cc));
  if (f.bcc) parts.push("bcc=" + encodeURIComponent(f.bcc));
  if (f.subject) parts.push("subject=" + encodeURIComponent(f.subject));
  if (f.body) parts.push("body=" + encodeURIComponent(f.body));
  return "googlegmail://co?" + parts.join("&");
}

/** https://mail.google.com compose fallback with authuser from config. */
function buildWebUrl(fields, authuser) {
  const f = fields || {};
  const user = authuser == null ? GMAIL_AUTHUSER : String(authuser);
  const parts = [
    "view=cm",
    "fs=1",
    "authuser=" + encodeURIComponent(user),
  ];
  if (f.to) parts.push("to=" + encodeURIComponent(f.to));
  if (f.cc) parts.push("cc=" + encodeURIComponent(f.cc));
  if (f.bcc) parts.push("bcc=" + encodeURIComponent(f.bcc));
  if (f.subject) parts.push("su=" + encodeURIComponent(f.subject));
  if (f.body) parts.push("body=" + encodeURIComponent(f.body));
  return "https://mail.google.com/mail/?" + parts.join("&");
}

module.exports = {
  GMAIL_AUTHUSER,
  MAX_TO,
  MAX_CC,
  MAX_BCC,
  MAX_SUBJECT,
  MAX_BODY,
  clip,
  looksLikeEmails,
  escapeHtml,
  parseGmailFields,
  buildAppUrl,
  buildWebUrl,
};
