/* Reading agent core: session lifecycle, chunked TTS, interrupt Q&A with
 * Claude tool use for linked sources, resume cursor, and metrics helpers.
 *
 * Article text is fetched at runtime and held in an ephemeral process
 * cache (re-fetched from the original URL on miss). The database stores
 * sourceUrl + metadata for metrics, never checked into the repo.
 *
 * Voice: READING_VOICE_ID or ELEVENLABS_VOICE_ID, falling back to the
 * stock Savvy premade. Never Tyler's personal voice id.
 */

"use strict";

const crypto = require("node:crypto");
const { callAnthropic } = require("./anthropic.js");
const { callElevenLabsTts, elevenLabsApiKey } = require("./essay-feed.js");
const { fetchPage, wordsFromText } = require("./fetch-page.js");
const {
  serviceToken,
  timingSafeEqual,
  extractBearer,
  newRequestId,
} = require("./transcribe.js");
const { DEFAULT_VOICE_ID } = require("./ask-sources/index.js");
const models = require("../../src/renderer/lib/claude-models.js");

const BANNED_VOICE_ID = "JlYdFGRHWwlz51Zh5K2n";
const LINKEDIN_URL = "https://www.linkedin.com/in/tlindow";
const EMAIL_URL = "mailto:tyler@lindowlabs.dev";
const MAX_QUESTION_CHARS = 2000;
const SPEAK_CHUNK_CHARS = 1800;
const SESSION_TEXT_TTL_MS = 60 * 60 * 1000;

/** @type {Map<string, { text: string, links: Array<{url:string,text:string}>, expiresAt: number }>} */
const textCache = new Map();

function readingVoiceId() {
  const raw =
    process.env.READING_VOICE_ID ||
    process.env.ELEVENLABS_VOICE_ID ||
    DEFAULT_VOICE_ID;
  const vid = String(raw || "").trim() || DEFAULT_VOICE_ID;
  if (vid === BANNED_VOICE_ID) return DEFAULT_VOICE_ID;
  return vid;
}

function readingModelId() {
  const raw =
    process.env.READING_MODEL ||
    process.env.ASK_MODEL ||
    models.FAST ||
    "claude-haiku-4-5-20251001";
  return String(raw).trim() || "claude-haiku-4-5-20251001";
}

function anthropicApiKey() {
  return String(process.env.ANTHROPIC_API_KEY || "").trim();
}

function newSessionId() {
  return `rs_${crypto.randomBytes(18).toString("hex")}`;
}

function cacheSessionText(sessionId, { text, links }) {
  textCache.set(sessionId, {
    text: String(text || ""),
    links: Array.isArray(links) ? links : [],
    expiresAt: Date.now() + SESSION_TEXT_TTL_MS,
  });
}

function getCachedText(sessionId) {
  const row = textCache.get(sessionId);
  if (!row) return null;
  if (Date.now() > row.expiresAt) {
    textCache.delete(sessionId);
    return null;
  }
  return row;
}

function clearCachedText(sessionId) {
  if (!sessionId) {
    textCache.clear();
    return;
  }
  textCache.delete(sessionId);
}

function normalizeInputType(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "voice" || v === "typed") return v;
  return "";
}

function normalizePosition(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  if (raw.wordIndex != null && Number.isFinite(Number(raw.wordIndex))) {
    out.wordIndex = Math.max(0, Math.floor(Number(raw.wordIndex)));
  }
  if (raw.charIndex != null && Number.isFinite(Number(raw.charIndex))) {
    out.charIndex = Math.max(0, Math.floor(Number(raw.charIndex)));
  }
  if (raw.timestampMs != null && Number.isFinite(Number(raw.timestampMs))) {
    out.timestampMs = Math.max(0, Math.floor(Number(raw.timestampMs)));
  }
  if (raw.paragraph != null && Number.isFinite(Number(raw.paragraph))) {
    out.paragraph = Math.max(0, Math.floor(Number(raw.paragraph)));
  }
  return Object.keys(out).length ? out : null;
}

function companyHostFromUrl(url) {
  try {
    const host = new URL(String(url)).hostname.toLowerCase().replace(/^www\./, "");
    return host.slice(0, 200);
  } catch {
    return "";
  }
}

function chunkTextFromWord(text, fromWordIndex, maxChars) {
  const words = wordsFromText(text);
  const start = Math.max(0, Math.min(words.length, Number(fromWordIndex) || 0));
  const limit = Math.max(200, Math.min(Number(maxChars) || SPEAK_CHUNK_CHARS, 5000));
  if (start >= words.length) {
    return {
      chunkText: "",
      fromWordIndex: start,
      toWordIndex: start,
      done: true,
      wordCount: words.length,
    };
  }
  const parts = [];
  let used = 0;
  let end = start;
  for (let i = start; i < words.length; i++) {
    const w = words[i];
    const next = used === 0 ? w.length : used + 1 + w.length;
    if (used > 0 && next > limit) break;
    parts.push(w);
    used = next;
    end = i + 1;
  }
  return {
    chunkText: parts.join(" "),
    fromWordIndex: start,
    toWordIndex: end,
    done: end >= words.length,
    wordCount: words.length,
  };
}

function positionSnippet(text, position) {
  if (!position || typeof position.wordIndex !== "number") return "";
  const words = wordsFromText(text);
  const i = Math.max(0, Math.min(words.length, position.wordIndex));
  const start = Math.max(0, i - 40);
  const end = Math.min(words.length, i + 40);
  return words.slice(start, end).join(" ");
}

function buildReadingSystem({ title, author, sourceUrl, text, links }) {
  const linkList = (links || [])
    .slice(0, 25)
    .map((l, i) => `${i + 1}. ${l.text || l.url} - ${l.url}`)
    .join("\n");
  return [
    "You are Tinker's reading agent. You read a public web article aloud for a visitor.",
    "Answer only from the article text (and any linked source you fetch with the tool).",
    "Attribute claims to the article or its author. Link the visitor back to the original URL.",
    "If you do not know, say so briefly and offer LinkedIn or email to reach Tyler.",
    "Reply in 2 to 4 short spoken sentences. No markdown. No bullet lists.",
    "Never use em dashes in your reply. Use commas, periods, or hyphens instead.",
    "Never invent quotes. Prefer the author's wording when summarizing.",
    "",
    `Original URL: ${sourceUrl}`,
    `Title: ${title || "(untitled)"}`,
    `Author: ${author || "(unknown)"}`,
    "",
    "ARTICLE TEXT:",
    String(text || "").slice(0, 50000),
    "",
    "OUTBOUND LINKS FROM THE ARTICLE (you may fetch these with fetch_linked_source):",
    linkList || "(none)",
    "",
    `Tyler LinkedIn: ${LINKEDIN_URL}`,
    `Tyler email: ${EMAIL_URL}`,
  ].join("\n");
}

const FETCH_LINK_TOOL = {
  name: "fetch_linked_source",
  description:
    "Fetch one outbound link from the article when the visitor's question needs that linked page. Only use a URL from the outbound links list.",
  input_schema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Absolute https URL of a link that appears in the article.",
      },
      reason: {
        type: "string",
        description: "Why this linked page is needed to answer.",
      },
    },
    required: ["url"],
  },
};

function linkAllowed(links, url) {
  const target = String(url || "").trim();
  if (!target) return false;
  return (links || []).some((l) => String(l.url) === target);
}

async function fetchLinkedSource(url, links, { fetchPageFn } = {}) {
  if (!linkAllowed(links, url)) {
    return {
      ok: false,
      error: "That URL is not in the article's outbound links.",
      url,
    };
  }
  const doFetch = fetchPageFn || fetchPage;
  try {
    const page = await doFetch(url);
    return {
      ok: true,
      url: page.sourceUrl,
      title: page.title,
      author: page.author,
      text: page.text.slice(0, 12000),
    };
  } catch (err) {
    return {
      ok: false,
      error: (err && err.message) || "Failed to fetch linked source",
      url,
    };
  }
}

function decideFetchLink({ question, links }) {
  // Deterministic helper for evals: should we fetch a linked source?
  const q = String(question || "").toLowerCase();
  const wantsSource =
    /\b(link|linked|source|paper|post|article|reference|cite|citation|read more|that url|the url)\b/.test(
      q,
    ) ||
    /\b(what does .+ say|according to the (linked|source)|from the (blog|docs|paper))\b/.test(
      q,
    );
  if (!wantsSource || !(links || []).length) {
    return { shouldFetch: false, url: null };
  }
  // Prefer a link whose anchor text appears in the question.
  for (const l of links) {
    const anchor = String(l.text || "").toLowerCase();
    if (anchor.length >= 4 && q.includes(anchor.slice(0, Math.min(40, anchor.length)))) {
      return { shouldFetch: true, url: l.url };
    }
  }
  // Or a hostname mentioned in the question.
  for (const l of links) {
    try {
      const host = new URL(l.url).hostname.replace(/^www\./, "").toLowerCase();
      if (host && q.includes(host.split(".")[0])) {
        return { shouldFetch: true, url: l.url };
      }
    } catch {
      /* continue */
    }
  }
  return { shouldFetch: true, url: links[0].url };
}

async function answerReadingQuestion({
  title,
  author,
  sourceUrl,
  text,
  links,
  question,
  input,
  rawTranscript,
  position,
  callClaude,
  fetchPageFn,
  model,
}) {
  const doCall = callClaude || callAnthropic;
  const modelId = model || readingModelId();
  const system = buildReadingSystem({ title, author, sourceUrl, text, links });
  const snippet = positionSnippet(text, position);
  const userParts = [
    `Visitor question (${input || "typed"}): ${question}`,
  ];
  if (input === "voice" && rawTranscript && rawTranscript !== question) {
    userParts.push(`Raw transcript before edits: ${rawTranscript}`);
  }
  if (snippet) {
    userParts.push(`Listener was around this passage when they interrupted:\n${snippet}`);
  }
  if (position && typeof position.wordIndex === "number") {
    userParts.push(`Resume cursor word index: ${position.wordIndex}`);
  }
  userParts.push(
    "If the answer needs an outbound linked page, call fetch_linked_source first. Otherwise answer from the article alone.",
  );

  const messages = [{ role: "user", content: userParts.join("\n\n") }];
  let fetchedSource = null;
  let toolUsed = false;

  const first = await doCall({
    system,
    messages,
    model: modelId,
    maxTokens: 500,
    tools: [FETCH_LINK_TOOL],
    tool_choice: { type: "auto" },
  });

  let content = Array.isArray(first.content) ? first.content : [];
  let answerText = String(first.text || "").trim();

  if (first.toolUse && first.toolUse.name === "fetch_linked_source") {
    toolUsed = true;
    const toolUrl = first.toolUse.input && first.toolUse.input.url;
    fetchedSource = await fetchLinkedSource(toolUrl, links, { fetchPageFn });
    const toolResult = {
      type: "tool_result",
      tool_use_id: first.toolUse.id || "tool_1",
      content: JSON.stringify(fetchedSource).slice(0, 14000),
    };
    // Rebuild assistant content with the tool_use block for the follow-up turn.
    const assistantContent =
      content.length > 0
        ? content
        : [
            {
              type: "tool_use",
              id: first.toolUse.id || "tool_1",
              name: "fetch_linked_source",
              input: first.toolUse.input || { url: toolUrl },
            },
          ];
    messages.push({ role: "assistant", content: assistantContent });
    messages.push({ role: "user", content: [toolResult] });

    const second = await doCall({
      system,
      messages,
      model: modelId,
      maxTokens: 500,
      tools: [FETCH_LINK_TOOL],
      tool_choice: { type: "none" },
    });
    answerText = String(second.text || "").trim() || answerText;
  }

  answerText = answerText
    .replace(/^```[\s\S]*?```$/g, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\u2014/g, ",") // strip em dashes from model output
    .trim();

  if (!answerText) {
    answerText = `I could not ground an answer in that article. The original is at ${sourceUrl}. You can also reach Tyler on LinkedIn.`;
  }

  return {
    answerText,
    model: modelId,
    toolUsed,
    fetchedSourceUrl:
      fetchedSource && fetchedSource.ok ? fetchedSource.url : toolUsed ? String((first.toolUse && first.toolUse.input && first.toolUse.input.url) || "") : "",
    fetchedSourceOk: Boolean(fetchedSource && fetchedSource.ok),
  };
}

async function speakChunk({ text, voiceId, apiKey, fetchFn, ttsFn }) {
  const doTts = ttsFn || callElevenLabsTts;
  const key = apiKey || elevenLabsApiKey();
  let vid = voiceId || readingVoiceId();
  if (vid === BANNED_VOICE_ID) vid = DEFAULT_VOICE_ID;
  if (!key) {
    throw Object.assign(new Error("ELEVENLABS_API_KEY is not configured on this deploy."), {
      status: 503,
    });
  }
  const generated = await doTts({ text, voiceId: vid, apiKey: key, fetchFn });
  return {
    audioBase64: generated.audioBase64 || "",
    contentType: generated.contentType || "audio/mpeg",
    voiceId: vid,
  };
}

async function ensureSessionText(sessionRow, { fetchPageFn } = {}) {
  const cached = getCachedText(sessionRow.id);
  if (cached && cached.text) {
    return { text: cached.text, links: cached.links || sessionRow.links || [] };
  }
  const page = await (fetchPageFn || fetchPage)(sessionRow.sourceUrl);
  const links = page.links || sessionRow.links || [];
  cacheSessionText(sessionRow.id, { text: page.text, links });
  return { text: page.text, links };
}

async function createSession(prismaClient, { url, caller, fetchPageFn, anonymousId, isOwner, embedHost }) {
  const page = await (fetchPageFn || fetchPage)(url);
  const id = newSessionId();
  const voiceId = readingVoiceId();
  cacheSessionText(id, { text: page.text, links: page.links });

  const data = {
    id,
    caller: caller || "anonymous",
    status: "active",
    sourceUrl: page.sourceUrl,
    requestedUrl: page.requestedUrl || page.sourceUrl,
    companyHost: companyHostFromUrl(page.sourceUrl),
    title: page.title || "",
    author: page.author || "",
    wordCount: page.wordCount || 0,
    links: page.links || [],
    resumeWordIndex: 0,
    voiceId,
    anonymousId: String(anonymousId || "").slice(0, 80),
    isOwner: Boolean(isOwner),
    embedHost: String(embedHost || "").slice(0, 200),
    questionCount: 0,
  };

  if (prismaClient && typeof prismaClient.readingSession?.create === "function") {
    try {
      await prismaClient.readingSession.create({ data });
    } catch (err) {
      console.error("[reading] failed to persist ReadingSession", err && err.message);
    }
  }

  const attribution =
    page.attribution ||
    [page.title, page.author ? `by ${page.author}` : "", page.siteName ? `(${page.siteName})` : ""]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    page.sourceUrl;

  return {
    sessionId: id,
    sourceUrl: page.sourceUrl,
    requestedUrl: page.requestedUrl,
    title: page.title,
    author: page.author,
    siteName: page.siteName || "",
    wordCount: page.wordCount,
    companyHost: data.companyHost,
    linkCount: (page.links || []).length,
    voiceId,
    // Short preview only; full text stays server-side / ephemeral cache.
    preview: page.paragraphs.slice(0, 2).join("\n\n").slice(0, 480),
    attribution,
  };
}

async function loadSession(prismaClient, sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;
  if (prismaClient && typeof prismaClient.readingSession?.findUnique === "function") {
    try {
      return await prismaClient.readingSession.findUnique({ where: { id } });
    } catch (err) {
      console.error("[reading] failed to load ReadingSession", err && err.message);
    }
  }
  return null;
}

async function updateResume(prismaClient, sessionId, wordIndex) {
  if (!prismaClient || typeof prismaClient.readingSession?.update !== "function") {
    return;
  }
  try {
    await prismaClient.readingSession.update({
      where: { id: sessionId },
      data: {
        resumeWordIndex: Math.max(0, Math.floor(Number(wordIndex) || 0)),
        updatedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("[reading] failed to update resume", err && err.message);
  }
}

async function logQuestion(prismaClient, row) {
  if (!prismaClient || typeof prismaClient.readingQuestion?.create !== "function") {
    return null;
  }
  try {
    return await prismaClient.readingQuestion.create({
      data: {
        id: row.id || newRequestId(),
        sessionId: row.sessionId,
        caller: row.caller || "",
        status: row.status || "ok",
        latencyMs: row.latencyMs || 0,
        inputType: row.inputType || "",
        question: row.question || "",
        rawTranscript: row.rawTranscript || "",
        answerText: row.answerText || "",
        model: row.model || "",
        voiceId: row.voiceId || "",
        hasAudio: Boolean(row.hasAudio),
        fetchedSource: Boolean(row.fetchedSource),
        fetchedSourceUrl: row.fetchedSourceUrl || "",
        resumeWordIndex: row.resumeWordIndex || 0,
        position: row.position || null,
        sourceUrl: row.sourceUrl || "",
        companyHost: row.companyHost || "",
        error: row.error || "",
        anonymousId: row.anonymousId || "",
        isOwner: Boolean(row.isOwner),
      },
    });
  } catch (err) {
    console.error("[reading] failed to persist ReadingQuestion", err && err.message);
    return null;
  }
}

async function bumpSessionQuestionCount(prismaClient, sessionId) {
  if (!prismaClient || typeof prismaClient.readingSession?.update !== "function") {
    return;
  }
  try {
    await prismaClient.readingSession.update({
      where: { id: sessionId },
      data: { questionCount: { increment: 1 } },
    });
  } catch (err) {
    console.error("[reading] failed to bump questionCount", err && err.message);
  }
}

async function logClick(prismaClient, row) {
  if (!prismaClient || typeof prismaClient.readingClick?.create !== "function") {
    return null;
  }
  try {
    return await prismaClient.readingClick.create({
      data: {
        id: row.id || newRequestId(),
        sessionId: row.sessionId || "",
        caller: row.caller || "",
        target: row.target || "",
        href: row.href || "",
        sourceUrl: row.sourceUrl || "",
        companyHost: row.companyHost || "",
        anonymousId: row.anonymousId || "",
        isOwner: Boolean(row.isOwner),
      },
    });
  } catch (err) {
    console.error("[reading] failed to persist ReadingClick", err && err.message);
    return null;
  }
}

async function collectMetrics(prismaClient) {
  const empty = {
    sessions: 0,
    questions: 0,
    questionsWithFetch: 0,
    answerLatencyMsAvg: 0,
    clicksLinkedIn: 0,
    clicksEmail: 0,
    byCompanyHost: [],
  };
  if (!prismaClient) return empty;

  try {
    const [sessions, questions, withFetch, clicks, latency, byHost] = await Promise.all([
      prismaClient.readingSession.count(),
      prismaClient.readingQuestion.count(),
      prismaClient.readingQuestion.count({ where: { fetchedSource: true } }),
      prismaClient.readingClick.groupBy({
        by: ["target"],
        _count: { _all: true },
      }),
      prismaClient.readingQuestion.aggregate({
        _avg: { latencyMs: true },
        where: { status: "ok" },
      }),
      prismaClient.readingSession.groupBy({
        by: ["companyHost"],
        _count: { _all: true },
        orderBy: { _count: { companyHost: "desc" } },
        take: 50,
      }),
    ]);

    const clickMap = {};
    for (const row of clicks || []) {
      clickMap[row.target] = row._count._all;
    }

    return {
      sessions,
      questions,
      questionsWithFetch: withFetch,
      answerLatencyMsAvg: Math.round(Number(latency?._avg?.latencyMs) || 0),
      clicksLinkedIn: clickMap.linkedin || 0,
      clicksEmail: clickMap.email || 0,
      byCompanyHost: (byHost || []).map((r) => ({
        companyHost: r.companyHost || "(unknown)",
        sessions: r._count._all,
      })),
    };
  } catch (err) {
    console.error("[reading] metrics failed", err && err.message);
    return empty;
  }
}

module.exports = {
  BANNED_VOICE_ID,
  LINKEDIN_URL,
  EMAIL_URL,
  DEFAULT_VOICE_ID,
  FETCH_LINK_TOOL,
  SPEAK_CHUNK_CHARS,
  readingVoiceId,
  readingModelId,
  anthropicApiKey,
  elevenLabsApiKey,
  serviceToken,
  timingSafeEqual,
  extractBearer,
  newRequestId,
  newSessionId,
  cacheSessionText,
  getCachedText,
  clearCachedText,
  normalizeInputType,
  normalizePosition,
  companyHostFromUrl,
  chunkTextFromWord,
  positionSnippet,
  buildReadingSystem,
  linkAllowed,
  fetchLinkedSource,
  decideFetchLink,
  answerReadingQuestion,
  speakChunk,
  ensureSessionText,
  createSession,
  loadSession,
  updateResume,
  logQuestion,
  bumpSessionQuestionCount,
  logClick,
  collectMetrics,
  fetchPage,
};
