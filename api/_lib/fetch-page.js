/* Fetch a public article URL and extract title, author, plain text, and
 * outbound links. Used by the reading agent at runtime.
 *
 * Never writes article bodies into the git repo. Callers may keep text in
 * an ephemeral session cache and re-fetch from the original URL.
 *
 * SSRF: only http(s), no credentials in URL, block loopback / private /
 * link-local / metadata hosts.
 */

"use strict";

const dns = require("node:dns").promises;
const net = require("node:net");
const { URL } = require("node:url");

const MAX_HTML_BYTES = 1_500_000;
const MAX_TEXT_CHARS = 60_000;
const MAX_LINKS = 40;
const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT =
  "TinkerReadingAgent/1.0 (+https://tinker.beginner.work; research reader)";

function isPrivateIp(ip) {
  const v = String(ip || "").trim().toLowerCase();
  if (!v) return true;
  if (v === "::1" || v === "0.0.0.0") return true;
  if (v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true;
  if (v.startsWith("127.")) return true;
  if (v.startsWith("10.")) return true;
  if (v.startsWith("192.168.")) return true;
  if (v.startsWith("169.254.")) return true;
  const m = v.match(/^172\.(\d+)\./);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  // IPv4-mapped IPv6
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return false;
}

function assertPublicHttpUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw || "").trim());
  } catch {
    throw Object.assign(new Error("url must be a valid http(s) URL"), { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw Object.assign(new Error("url must use http or https"), { status: 400 });
  }
  if (parsed.username || parsed.password) {
    throw Object.assign(new Error("url must not include credentials"), { status: 400 });
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal" ||
    host === "metadata"
  ) {
    throw Object.assign(new Error("url host is not allowed"), { status: 400 });
  }
  if (net.isIP(host) && isPrivateIp(host)) {
    throw Object.assign(new Error("url host is not allowed"), { status: 400 });
  }
  return parsed;
}

async function assertResolvesPublic(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw Object.assign(new Error("url host is not allowed"), { status: 400 });
    }
    return;
  }
  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw Object.assign(new Error("Could not resolve url host"), { status: 400 });
  }
  if (!records || !records.length) {
    throw Object.assign(new Error("Could not resolve url host"), { status: 400 });
  }
  for (const r of records) {
    if (isPrivateIp(r.address)) {
      throw Object.assign(new Error("url host is not allowed"), { status: 400 });
    }
  }
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function stripTags(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article|header|footer)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );
}

function metaContent(html, names) {
  const lower = String(html || "");
  for (const name of names) {
    const re1 = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      "i",
    );
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
      "i",
    );
    const m = lower.match(re1) || lower.match(re2);
    if (m && m[1]) return decodeEntities(m[1]).trim();
  }
  return "";
}

function extractTitle(html) {
  const og = metaContent(html, ["og:title", "twitter:title"]);
  if (og) return og.slice(0, 300);
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m) return decodeEntities(stripTags(m[1])).slice(0, 300);
  const h1 = String(html || "").match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return decodeEntities(stripTags(h1[1])).slice(0, 300);
  return "";
}

function walkJsonLdNodes(html) {
  const nodes = [];
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    if (Array.isArray(data)) nodes.push(...data);
    else if (data && typeof data === "object") {
      nodes.push(data);
      if (Array.isArray(data["@graph"])) nodes.push(...data["@graph"]);
    }
  }
  return nodes;
}

function authorsFromJsonLd(html) {
  const names = [];
  for (const node of walkJsonLdNodes(html)) {
    if (!node || typeof node !== "object") continue;
    const type = String(node["@type"] || "");
    if (!/Article|BlogPosting|NewsArticle|TechArticle|WebPage/i.test(type)) continue;
    const author = node.author;
    const list = Array.isArray(author) ? author : author ? [author] : [];
    for (const a of list) {
      if (typeof a === "string" && a.trim()) names.push(a.trim());
      else if (a && typeof a === "object" && a.name) {
        names.push(String(a.name).trim());
      }
    }
  }
  return names.filter(Boolean);
}

function organizationFromJsonLd(html) {
  for (const node of walkJsonLdNodes(html)) {
    if (!node || typeof node !== "object") continue;
    const type = String(node["@type"] || "");
    if (/^Organization$/i.test(type) && node.name) {
      return String(node.name).trim().slice(0, 200);
    }
    if (node.publisher && typeof node.publisher === "object" && node.publisher.name) {
      return String(node.publisher.name).trim().slice(0, 200);
    }
    if (node.isPartOf && typeof node.isPartOf === "object" && node.isPartOf.name) {
      return String(node.isPartOf.name).trim().slice(0, 200);
    }
  }
  return "";
}

function extractSiteName(html) {
  return metaContent(html, ["og:site_name", "application-name", "twitter:site"])
    .replace(/^@/, "")
    .slice(0, 200);
}

/**
 * Author extraction order (never invent; never use the model):
 * 1. schema.org / JSON-LD author
 * 2. meta name=author
 * 3. article:author (and og:article:author)
 * 4. byline / rel=author
 * 5. site's organization name (JSON-LD Organization / publisher / og:site_name)
 *
 * @returns {{ author: string, authorSource: string, authorUnknown: boolean, siteName: string }}
 */
function resolveAuthorAttribution(html) {
  const siteName =
    extractSiteName(html) || organizationFromJsonLd(html) || "";

  const ld = authorsFromJsonLd(html);
  if (ld.length) {
    return {
      author: ld.join(", ").slice(0, 200),
      authorSource: "jsonld",
      authorUnknown: false,
      siteName,
    };
  }

  const metaAuthor = metaContent(html, ["author"]);
  if (metaAuthor && !/^https?:/i.test(metaAuthor)) {
    return {
      author: metaAuthor.slice(0, 200),
      authorSource: "meta_author",
      authorUnknown: false,
      siteName,
    };
  }

  const articleAuthor = metaContent(html, [
    "article:author",
    "og:article:author",
    "citation_author",
    "sailthru.author",
  ]);
  if (articleAuthor && !/^https?:/i.test(articleAuthor)) {
    return {
      author: articleAuthor.slice(0, 200),
      authorSource: "article_author",
      authorUnknown: false,
      siteName,
    };
  }

  const rel = String(html || "").match(
    /<a[^>]+rel=["'][^"']*author[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
  );
  if (rel) {
    const t = decodeEntities(stripTags(rel[1])).trim();
    if (t && t.length < 120) {
      return {
        author: t.slice(0, 200),
        authorSource: "rel_author",
        authorUnknown: false,
        siteName,
      };
    }
  }
  const byline = String(html || "").match(
    /class=["'][^"']*\b(?:author|byline)\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div|p|a|h[1-6])>/i,
  );
  if (byline) {
    const t = decodeEntities(stripTags(byline[1])).trim();
    if (t && t.length < 120 && !/^https?:/i.test(t)) {
      return {
        author: t.slice(0, 200),
        authorSource: "byline",
        authorUnknown: false,
        siteName,
      };
    }
  }

  const org = organizationFromJsonLd(html) || siteName;
  if (org) {
    return {
      author: org.slice(0, 200),
      authorSource: "organization",
      authorUnknown: false,
      siteName: siteName || org,
    };
  }

  return {
    author: "",
    authorSource: "none",
    authorUnknown: true,
    siteName,
  };
}

/** @deprecated Prefer resolveAuthorAttribution — kept for call-site compatibility. */
function extractAuthor(html) {
  return resolveAuthorAttribution(html).author;
}

function extractMainHtml(html) {
  const raw = String(html || "");
  const article = raw.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (article) return article[1];
  const main = raw.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (main) return main[1];
  const role = raw.match(
    /<div[^>]+role=["']main["'][^>]*>([\s\S]*?)<\/div>/i,
  );
  if (role) return role[1];
  // Drop chrome-heavy regions before body strip.
  return raw
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ");
}

function extractLinks(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || ""))) && out.length < MAX_LINKS) {
    let href = decodeEntities(m[1]).trim();
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) continue;
    let abs;
    try {
      abs = new URL(href, baseUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:/i.test(abs)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    const text = decodeEntities(stripTags(m[2])).replace(/\s+/g, " ").trim().slice(0, 160);
    out.push({ url: abs, text: text || abs });
  }
  return out;
}

function paragraphsFromText(text) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
}

function wordsFromText(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

async function fetchPage(url, { fetchFn, lookupFn } = {}) {
  const parsed = assertPublicHttpUrl(url);
  const doLookup = lookupFn || assertResolvesPublic;
  await doLookup(parsed.hostname);

  const doFetch = fetchFn || fetch;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    : null;

  let res;
  try {
    res = await doFetch(parsed.href, {
      method: "GET",
      redirect: "follow",
      signal: controller ? controller.signal : undefined,
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent": USER_AGENT,
      },
    });
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw Object.assign(new Error("Timed out fetching url"), { status: 504 });
    }
    throw Object.assign(new Error("Failed to fetch url"), { status: 502 });
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!res.ok) {
    throw Object.assign(new Error(`Upstream returned ${res.status}`), { status: 502 });
  }

  const finalUrl = String(res.url || parsed.href);
  // Re-check redirect target host.
  try {
    const finalParsed = assertPublicHttpUrl(finalUrl);
    await doLookup(finalParsed.hostname);
  } catch (err) {
    throw Object.assign(new Error("Redirect target is not allowed"), {
      status: err.status || 400,
    });
  }

  const ctype = String(res.headers.get("content-type") || "").toLowerCase();
  if (ctype && !ctype.includes("html") && !ctype.includes("text/plain") && !ctype.includes("xml")) {
    throw Object.assign(new Error("url did not return HTML"), { status: 415 });
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_HTML_BYTES) {
    throw Object.assign(new Error("Page is too large to read"), { status: 413 });
  }
  const html = buf.toString("utf8");
  const title = extractTitle(html) || parsed.hostname;
  const attr = resolveAuthorAttribution(html);
  const author = attr.author;
  const siteName = attr.siteName;
  const mainHtml = extractMainHtml(html);
  let text = stripTags(mainHtml).slice(0, MAX_TEXT_CHARS);
  if (text.length < 80) {
    text = stripTags(html).slice(0, MAX_TEXT_CHARS);
  }
  if (text.length < 40) {
    throw Object.assign(new Error("Could not extract readable article text"), {
      status: 422,
    });
  }
  const links = extractLinks(mainHtml || html, finalUrl);
  const paragraphs = paragraphsFromText(text);
  const words = wordsFromText(text);
  const attribution = formatByline({
    author,
    authorUnknown: attr.authorUnknown,
    siteName,
    title,
  });

  if (attr.authorUnknown) {
    logAuthorUnknown({ sourceUrl: finalUrl, title, siteName });
  }

  return {
    sourceUrl: finalUrl,
    requestedUrl: parsed.href,
    title,
    author,
    authorSource: attr.authorSource,
    authorUnknown: Boolean(attr.authorUnknown),
    siteName,
    attribution: attribution || title || finalUrl,
    text,
    paragraphs,
    wordCount: words.length,
    links,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Display byline: "By <Author>" (or "Author unknown") plus optional site.
 * Never invents an author — empty/unknown stays "Author unknown".
 */
function formatByline({ author, authorUnknown, siteName, title } = {}) {
  void authorUnknown;
  const known = String(author || "").trim();
  const byline = known ? `By ${known}` : "Author unknown";
  const site = String(siteName || "").trim();
  return [title ? String(title).trim() : "", byline, site ? `(${site})` : ""]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function logAuthorUnknown({ sourceUrl, title, siteName } = {}) {
  console.warn(
    JSON.stringify({
      kind: "reading_author_unknown",
      sourceUrl: String(sourceUrl || ""),
      title: String(title || ""),
      siteName: String(siteName || ""),
    }),
  );
}

module.exports = {
  MAX_TEXT_CHARS,
  MAX_LINKS,
  USER_AGENT,
  isPrivateIp,
  assertPublicHttpUrl,
  assertResolvesPublic,
  decodeEntities,
  stripTags,
  extractTitle,
  extractAuthor,
  extractSiteName,
  authorsFromJsonLd,
  organizationFromJsonLd,
  resolveAuthorAttribution,
  formatByline,
  logAuthorUnknown,
  extractMainHtml,
  extractLinks,
  paragraphsFromText,
  wordsFromText,
  fetchPage,
};
