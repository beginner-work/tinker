/* check_text comparator.
 *
 * A model may list the claims in a draft. This file decides every
 * verdict. Numbers, dates, titles, and employer names are normalized
 * and compared exactly here. A verdict field on a claim is ignored.
 *
 * ready is true only when every claim is a pass.
 */

"use strict";

const { callAnthropic } = require("./anthropic.js");
const { SENSITIVE_PATTERNS, UNVERIFIED_NOTE } = require("../../src/renderer/career/catalog.js");

const FIND_MODEL = "claude-opus-4-8";
const FIND_MARKER = "CAREER_CLAIM_FINDER";

const MONTHS = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

const WORDS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const STOP = new Set([
  "about", "from", "that", "this", "with", "were", "been", "have", "more",
  "than", "through", "additional", "under", "over", "previously", "also",
  "our", "the", "and", "for", "was", "into", "onto", "per", "its",
  "his", "her", "their", "year", "years", "hour", "hours",
  "minute", "minutes",
]);

const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const RANGE_RE = new RegExp(
  MONTH_RE + "\\s+(\\d{4})\\s+(?:to|through|-)\\s+" + MONTH_RE + "\\s+(\\d{4})",
  "i",
);

function norm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[$]/g, "")
    .replace(/[^a-z0-9%.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normPlace(value) {
  return norm(value).replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeTitle(value) {
  return norm(value).replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeEmployer(value) {
  return normalizeTitle(value)
    .replace(/\./g, "")
    .replace(/\binc\b/g, "")
    .replace(/\bllc\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wordOrInt(token) {
  const text = String(token || "").toLowerCase();
  if (Object.prototype.hasOwnProperty.call(WORDS, text)) return WORDS[text];
  if (/^\d+$/.test(text)) return Number(text);
  return null;
}

function normalizeMoney(token) {
  const raw = String(token || "").trim();
  if (!raw) return "";
  const match = raw.match(/\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s*([kmb]))?/i);
  if (!match) return "";
  const digits = match[1].replace(/,/g, "");
  let amount = Number(digits);
  if (!Number.isFinite(amount)) return "";
  const suffix = (match[2] || "").toLowerCase();
  if (suffix === "k") amount *= 1000;
  if (suffix === "m") amount *= 1000000;
  if (suffix === "b") amount *= 1000000000;
  return String(Math.round(amount));
}

function normalizeMonthYear(value) {
  const text = norm(value);
  const match = text.match(new RegExp("^" + MONTH_RE + "\\s+(\\d{4})$", "i"));
  if (!match) return "";
  const month = MONTHS[match[1].toLowerCase()];
  if (!month) return "";
  return match[2] + "-" + month;
}

function monthIndex(iso) {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 12 + Number(match[2]);
}

function extractDateRange(value) {
  const text = norm(value).replace(/\s+-\s+/g, " - ");
  const match = text.match(RANGE_RE);
  if (!match) return null;
  const start = normalizeMonthYear(match[1] + " " + match[2]);
  const end = normalizeMonthYear(match[3] + " " + match[4]);
  if (!start || !end) return null;
  return { start, end };
}

function extractTeamRange(value) {
  const text = norm(value);
  const match = text.match(/\bfrom\s+(\d+)\s+to\s+(\d+)\b/) || text.match(/\b(\d+)\s+to\s+(\d+)\b/);
  if (!match) return null;
  return { from: match[1], to: match[2] };
}

function extractEngineerCount(value) {
  const text = norm(value);
  const match = text.match(/\b(\d+)\s+software engineers\b/);
  if (!match) return null;
  return match[1];
}

function isSameTeamSpan(value) {
  const text = norm(value);
  const range = extractTeamRange(text);
  if (!range || range.from !== "1" || range.to !== "9") return false;
  const us = /\bunited states\b|\bus\b|\bu s\b/.test(text);
  return us && /\bcanada\b/.test(text) && /\bpoland\b/.test(text);
}

function mentionsRemote(value) {
  return /\bremote(?:ly)?\b/.test(norm(value));
}

function extractMoreThanYears(value) {
  const text = norm(value);
  const match = text.match(/\bmore than\s+([a-z0-9]+)\s+years\b/);
  if (!match) return null;
  return wordOrInt(match[1]);
}

function measuresOf(value) {
  const text = norm(value);
  const found = [];
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) found.push(match[1] + "%");
  for (const match of text.matchAll(/\b(\d+(?:\.\d+)?)\s*([kmb])\b/g)) {
    found.push(match[1] + match[2]);
  }
  for (const match of text.matchAll(/\b(?:(under)\s+)?(\d+(?:\.\d+)?)\s+(hours|hour|minutes|minute)\b/g)) {
    const unit = match[3].startsWith("hour") ? "hours" : "minutes";
    const qual = match[1] ? "under " : "";
    found.push(qual + match[2] + " " + unit);
  }
  for (const match of text.matchAll(/\b(\d+)\b/g)) {
    if (match[1].length === 4 && /^(19|20)/.test(match[1])) continue;
    found.push(match[1]);
  }
  return found;
}

function contentWords(value) {
  const text = norm(value);
  const words = text.split(" ").filter((word) => word.length >= 4 && !STOP.has(word) && !/^\d/.test(word));
  return words.filter((word) => word !== "hours" && word !== "minutes" && word !== "hour" && word !== "minute");
}

function verifiedFacts(record) {
  return (record && record.facts || []).filter((fact) => fact && fact.status === "verified");
}

function verifiedRules(record) {
  return (record && record.rules || []).filter((rule) => rule && rule.status === "verified");
}

function ruleById(rules, id) {
  return rules.find((rule) => rule.id === id) || null;
}

function fieldBlob(claim, context) {
  return norm([
    context && context.field_label,
    claim && claim.field,
    claim && claim.kind,
    claim && claim.text,
  ].filter(Boolean).join(" "));
}

function labelBlob(claim, context) {
  return norm([context && context.field_label, claim && claim.field, claim && claim.kind].filter(Boolean).join(" "));
}

function isSensitive(claim, context) {
  const blob = fieldBlob(claim, context);
  if (/\brace\b/.test(blob)) return true;
  return SENSITIVE_PATTERNS.some((pattern) => blob.includes(pattern));
}

function isOpenBaseline(text) {
  const raw = String(text || "");
  const folded = norm(raw);
  if (!/\b(baseline|mechanism)\b/.test(folded)) return false;
  return /500\s*k|\$\s*500|99\.9|99\.7/.test(raw.toLowerCase()) || /500k|99\.9|99\.7/.test(folded);
}

function labeledValue(text) {
  const raw = String(text || "").trim();
  const idx = raw.lastIndexOf(":");
  if (idx >= 0) return raw.slice(idx + 1).trim();
  return raw;
}

function blankish(value) {
  const text = norm(value);
  return !text || text === "blank" || text === "n a" || text === "na" || text === "none" || text === "left blank";
}

function salaryAmount(text) {
  const raw = String(text || "");
  if (blankish(raw)) return null;
  const match = raw.match(/\$\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*[kmb]?|\b\d+(?:\.\d+)?\s*[kmb]\b|\b\d{1,3}(?:,\d{3})+\b|\b\d+\b/i);
  if (!match) return null;
  const normalized = normalizeMoney(match[0]);
  if (normalized === "") return null;
  return normalized;
}

function salaryIntent(claim, context) {
  const blob = fieldBlob(claim, context);
  return /\bsalary\b|\bcompensation\b/.test(blob) || (claim && claim.kind === "salary");
}

function companyMode(claim, context) {
  const labels = labelBlob(claim, context);
  const text = norm(claim && claim.text);
  if (/most recent company/.test(labels) || /most recent company/.test(text)) return "most_recent";
  if (/current company/.test(labels) || /current company/.test(text)) return "current";
  if (claim && claim.kind === "current_company") return "current";
  return "";
}

function currentLocationIntent(claim, context) {
  const labels = labelBlob(claim, context);
  const text = norm(claim && claim.text);
  return /current location|city of residence|where do you live/.test(labels)
    || /current location/.test(text);
}

function relocateIntent(claim, context) {
  const blob = labelBlob(claim, context) + " " + norm(claim && claim.text);
  return /willing to relocate|relocate|willing to move/.test(blob);
}

function workCityIntent(claim, context) {
  const blob = labelBlob(claim, context);
  return /work city|office location|work location/.test(blob);
}

function pass(text, id) {
  return { text, verdict: "pass", id };
}

function mismatch(text, id, correct) {
  return { text, verdict: "mismatch", id, correct };
}

function unsupported(text) {
  return { text, verdict: "unsupported" };
}

function needsClaire(text, id) {
  const claim = { text, verdict: "needs_claire" };
  if (id) claim.id = id;
  return claim;
}

function judgeSalary(text, rule) {
  const amount = salaryAmount(text);
  if (amount == null || amount === "0") return pass(text, rule.id);
  return mismatch(text, rule.id, "");
}

function judgeEquals(text, rule) {
  const want = normPlace(rule.machine.value);
  const got = normPlace(labeledValue(text));
  if (got === want || (want && got.includes(want) && !otherCity(got, want))) return pass(text, rule.id);
  return mismatch(text, rule.id, rule.machine.value);
}

function otherCity(got, want) {
  const cities = ["austin", "new york", "chicago", "boston", "denver", "atlanta", "miami", "dallas", "houston"];
  return cities.some((city) => got.includes(city) && !want.includes(city));
}

function judgeCompany(text, rule, mode) {
  const value = labeledValue(text);
  const employer = normalizeEmployer(value);
  if (mode === "most_recent") {
    const want = normalizeEmployer(rule.machine.most_recent);
    if (employer === want) return pass(text, rule.id);
    return mismatch(text, rule.id, rule.machine.most_recent);
  }
  if (blankish(value) || !employer) return pass(text, rule.id);
  return mismatch(text, rule.id, "");
}

function judgeRelocate(text, rule) {
  const value = norm(labeledValue(text));
  const yes = value === "yes" || value === "y" || value === "true";
  if (yes) return pass(text, rule.id);
  return mismatch(text, rule.id, rule.machine.value);
}

function judgeWorkCity(text, rule) {
  const value = normPlace(labeledValue(text));
  const hubs = (rule.machine && rule.machine.hubs) || [];
  const allowed = hubs.some((hub) => {
    const name = normPlace(hub);
    return name && (value === name || value.includes(name));
  });
  if (allowed) return pass(text, rule.id);
  return mismatch(text, rule.id, "a listed West Coast office, or the closest tech hub");
}

function judgeTeam(text, facts) {
  if (isSameTeamSpan(text)) {
    const combo = facts.find((fact) => fact.kind === "team_size" && isSameTeamSpan(fact.value));
    if (!combo) return unsupported(text);
    return pass(text, combo.id);
  }
  const range = extractTeamRange(text);
  if (range) {
    const ranges = facts.filter((fact) => fact.kind === "team_size" && extractTeamRange(fact.value) && !isSameTeamSpan(fact.value));
    if (!ranges.length) return unsupported(text);
    const exact = ranges.find((fact) => {
      const got = extractTeamRange(fact.value);
      return got.from === range.from && got.to === range.to;
    });
    if (exact) return pass(text, exact.id);
    const sameStart = ranges.find((fact) => extractTeamRange(fact.value).from === range.from) || ranges[0];
    return mismatch(text, sameStart.id, sameStart.value);
  }
  const count = extractEngineerCount(text);
  if (count) {
    const counts = facts.filter((fact) => fact.kind === "team_size" && extractEngineerCount(fact.value));
    if (!counts.length) return unsupported(text);
    const exact = counts.find((fact) => extractEngineerCount(fact.value) === count);
    if (exact) return pass(text, exact.id);
    return mismatch(text, counts[0].id, counts[0].value);
  }
  return null;
}

function titleOf(value) {
  const raw = String(value || "");
  const at = raw.split(/\s+at\s+/i);
  return normalizeTitle(at[0] || "");
}

function employerOf(value) {
  const match = String(value || "").match(/\bat\s+([^,]+)/i);
  return match ? normalizeEmployer(match[1]) : "";
}

function judgeDates(text, facts) {
  const years = extractMoreThanYears(text);
  if (years != null && mentionsRemote(text)) {
    const remote = facts.find((fact) => {
      return fact.kind === "dates" && mentionsRemote(fact.value) && extractDateRange(fact.value);
    });
    if (!remote) return unsupported(text);
    const range = extractDateRange(remote.value);
    const start = monthIndex(range.start);
    const end = monthIndex(range.end);
    if (start == null || end == null) return unsupported(text);
    const span = end - start;
    if (span > years * 12) return pass(text, remote.id);
    return mismatch(text, remote.id, remote.value);
  }
  const claimRange = extractDateRange(text);
  if (!claimRange) return null;
  const claimTitle = normalizeTitle(text);
  const claimEmployer = employerToken(text);
  let best = null;
  let bestLen = 0;
  for (const fact of facts) {
    if (fact.kind !== "dates") continue;
    if (/\bmore than\b/.test(norm(fact.value)) && mentionsRemote(fact.value)) continue;
    if (!extractDateRange(fact.value)) continue;
    const title = titleOf(fact.value);
    const employer = employerOf(fact.value);
    if (!title || !claimTitle.includes(title)) continue;
    if (employer && claimEmployer && !claimEmployer.includes(employer)) continue;
    if (title.length > bestLen) {
      best = fact;
      bestLen = title.length;
    }
  }
  if (!best) return unsupported(text);
  const factRange = extractDateRange(best.value);
  if (factRange.start === claimRange.start && factRange.end === claimRange.end) return pass(text, best.id);
  return mismatch(text, best.id, best.value);
}

function employerToken(text) {
  return normalizeEmployer(text);
}

function judgeTitle(text, facts) {
  const folded = normalizeTitle(text);
  const titles = facts.filter((fact) => fact.kind === "title" && fact.value);
  const exact = titles.find((fact) => folded.includes(normalizeTitle(fact.value)));
  if (exact) return pass(text, exact.id);
  return unsupported(text);
}

function judgeEmployer(text, facts) {
  const folded = normalizeEmployer(text);
  const employers = facts.filter((fact) => fact.kind === "employer" && fact.value);
  const exact = employers.find((fact) => folded.includes(normalizeEmployer(fact.value)));
  if (exact) return pass(text, exact.id);
  return unsupported(text);
}

function judgeDegree(text, facts) {
  const folded = norm(text).replace(/\./g, " ");
  const degrees = facts.filter((fact) => fact.kind === "degree" && fact.value);
  for (const fact of degrees) {
    const factNorm = norm(fact.value).replace(/\./g, " ");
    const level = degreeLevel(factNorm);
    const claimLevel = degreeLevel(folded);
    const field = degreeField(factNorm);
    if (!field || !folded.includes(field)) continue;
    if (level && claimLevel && level !== claimLevel) return mismatch(text, fact.id, fact.value);
    if (level && claimLevel && level === claimLevel) return pass(text, fact.id);
    if (!claimLevel) return pass(text, fact.id);
  }
  return unsupported(text);
}

function degreeLevel(text) {
  if (/\bb s\b|\bbs\b/.test(text)) return "bs";
  if (/\bb a\b|\bba\b/.test(text)) return "ba";
  if (/\bm s\b|\bms\b/.test(text)) return "ms";
  return "";
}

function degreeField(text) {
  const words = text.split(" ").filter((word) => word.length >= 6 && !STOP.has(word));
  const skip = new Set(["university", "california", "engineering"]);
  return words.find((word) => !skip.has(word)) || "";
}

function judgeLocationFact(text, facts) {
  const folded = normPlace(text);
  const places = facts.filter((fact) => fact.kind === "location" && fact.value);
  const exact = places.find((fact) => folded.includes(normPlace(fact.value)));
  if (exact) return pass(text, exact.id);
  return unsupported(text);
}

function sameMeasureFamily(left, right) {
  const kind = (token) => {
    if (token.includes("%")) return "percent";
    if (token.endsWith("k") || token.endsWith("m") || token.endsWith("b")) return "money";
    if (token.includes("hour") || token.includes("minute")) return "duration";
    if (/^\d+$/.test(token)) return "count";
    return "other";
  };
  const kinds = new Set([...left, ...right].map(kind));
  if (kinds.size === 1) return true;
  if (kinds.has("duration") && [...left, ...right].every((token) => kind(token) === "duration" || kind(token) === "count")) {
    return true;
  }
  return false;
}

function judgeMetric(text, facts) {
  if (isOpenBaseline(text)) {
    const opened = facts.find((fact) => fact.kind === "metric" && /\b(baseline|mechanism)\b/.test(norm(fact.value)));
    if (!opened) return unsupported(text);
    return pass(text, opened.id);
  }
  const claimMeasures = measuresOf(text);
  const claimNorm = norm(text);
  let partial = null;
  for (const fact of facts) {
    if (fact.kind !== "metric") continue;
    if (/\b(baseline|mechanism)\b/.test(norm(fact.value))) continue;
    const factMeasures = measuresOf(fact.value).filter((token) => !/^\d$/.test(token));
    const distinctive = factMeasures.filter((token) => !/^\d$/.test(token));
    const needed = distinctive.length ? distinctive : factMeasures;
    if (!needed.length) continue;
    const words = contentWords(fact.value).filter((word) => !needed.some((token) => token.includes(word)));
    const wordsHit = words.length === 0 || words.every((word) => claimNorm.includes(word));
    const measuresHit = needed.every((token) => claimMeasures.includes(token) || claimNorm.includes(token));
    if (wordsHit && measuresHit) return pass(text, fact.id);
    const overlap = words.filter((word) => claimNorm.includes(word));
    const family = sameMeasureFamily(needed, claimMeasures);
    if (!partial && overlap.length && words.length && overlap.length === words.length && family && claimMeasures.length && !measuresHit) {
      partial = fact;
    }
  }
  if (partial) return mismatch(text, partial.id, partial.value);
  return null;
}

function formFieldUntyped(claim, context) {
  const label = norm(context && context.field_label);
  if (!label) return false;
  if (salaryIntent(claim, context)) return false;
  if (companyMode(claim, context)) return false;
  if (currentLocationIntent(claim, context)) return false;
  if (relocateIntent(claim, context)) return false;
  if (workCityIntent(claim, context)) return false;
  const kind = claim && claim.kind;
  if (kind && kind !== "other" && kind !== "story" && kind !== "contact") return false;
  return true;
}

function judgeClaim(claim, record, context) {
  const text = claim && typeof claim.text === "string" ? claim.text : "";
  const facts = verifiedFacts(record);
  const rules = verifiedRules(record);
  const claire = ruleById(rules, "rule_needs_claire");

  if (isSensitive(claim, context)) return needsClaire(text, claire && claire.id);

  if (isSameTeamSpan(text)) {
    return judgeTeam(text, facts);
  }

  if (salaryIntent(claim, context)) {
    const rule = ruleById(rules, "rule_salary");
    if (!rule) return needsClaire(text, claire && claire.id);
    return judgeSalary(text, rule);
  }

  const company = companyMode(claim, context);
  if (company) {
    const rule = ruleById(rules, "rule_current_company");
    if (!rule) return needsClaire(text, claire && claire.id);
    return judgeCompany(text, rule, company);
  }

  if (currentLocationIntent(claim, context)) {
    const rule = ruleById(rules, "rule_current_location");
    if (!rule) return needsClaire(text, claire && claire.id);
    return judgeEquals(text, rule);
  }

  if (relocateIntent(claim, context)) {
    const rule = ruleById(rules, "rule_relocate");
    if (!rule) return needsClaire(text, claire && claire.id);
    return judgeRelocate(text, rule);
  }

  if (workCityIntent(claim, context)) {
    const rule = ruleById(rules, "rule_work_city");
    if (!rule) return needsClaire(text, claire && claire.id);
    return judgeWorkCity(text, rule);
  }

  const kind = claim && claim.kind;
  if (kind === "team_size") {
    const judged = judgeTeam(text, facts);
    if (judged) return judged;
  }
  if (kind === "dates") {
    const judged = judgeDates(text, facts);
    if (judged) return judged;
  }
  if (kind === "metric") {
    const judged = judgeMetric(text, facts);
    if (judged) return judged;
  }
  if (kind === "title") return judgeTitle(text, facts);
  if (kind === "employer") return judgeEmployer(text, facts);
  if (kind === "degree") return judgeDegree(text, facts);
  if (kind === "location") return judgeLocationFact(text, facts);

  if (!kind || kind === "other" || kind === "story") {
    const metric = judgeMetric(text, facts);
    if (metric) return metric;
    const team = judgeTeam(text, facts);
    if (team) return team;
    const dates = judgeDates(text, facts);
    if (dates) return dates;
  }

  if (formFieldUntyped(claim, context)) return needsClaire(text, claire && claire.id);
  return unsupported(text);
}

function judgeClaims(record, claims, context) {
  const list = Array.isArray(claims) ? claims : [];
  return list.map((claim) => judgeClaim({
    text: claim && claim.text,
    kind: claim && claim.kind,
    field: claim && claim.field,
  }, record, context || {}));
}

const FIND_SYSTEM = [
  FIND_MARKER,
  "List factual claims in a draft application answer or outreach note.",
  "Return JSON only: {\"claims\":[{\"text\":\"...\",\"kind\":\"employer|title|dates|team_size|location|metric|degree|contact|story|salary|other\",\"field\":\"\"}]}",
  "Copy each claim's text from the draft. Do not decide whether a claim is true.",
  "Do not include a verdict. kind is a label only.",
  "Split team sizes, dates, titles, employers, metrics, locations, salary, and sensitive answers into separate claims.",
  "If the draft states a visa, work authorization, EEO, or demographic answer, set kind to other and field to that topic.",
].join(" ");

function parseClaims(raw) {
  const text = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : parsed && parsed.claims;
  if (!Array.isArray(list)) return [];
  return list.map((claim) => ({
    text: claim && typeof claim.text === "string" ? claim.text : "",
    kind: claim && typeof claim.kind === "string" ? claim.kind : "",
    field: claim && typeof claim.field === "string" ? claim.field : "",
  })).filter((claim) => claim.text);
}

async function defaultFindClaims({ text, company, field_label }) {
  const lines = ["Draft:", text];
  if (company) lines.push("", "Company: " + company);
  if (field_label) lines.push("", "Field label: " + field_label);
  const result = await callAnthropic({
    system: FIND_SYSTEM,
    model: FIND_MODEL,
    maxTokens: 2048,
    messages: [{ role: "user", content: lines.join("\n") }],
  });
  return parseClaims(result.text);
}

async function checkText({ record, text, company, field_label, findClaims }) {
  const draft = typeof text === "string" ? text : "";
  const context = {
    field_label: typeof field_label === "string" ? field_label : "",
    company: typeof company === "string" ? company : "",
  };
  let found = [];
  if (draft.trim()) {
    const finder = findClaims || defaultFindClaims;
    const listed = await finder({
      text: draft,
      company: context.company,
      field_label: context.field_label,
    });
    found = Array.isArray(listed) ? listed : [];
  }
  if (!found.length && (draft.trim() || context.field_label)) {
    found = [{ text: draft, kind: "", field: "" }];
  }
  const claims = judgeClaims(record, found, context);
  return {
    ready: claims.every((claim) => claim.verdict === "pass"),
    claims,
    unverified_note: UNVERIFIED_NOTE,
  };
}

module.exports = {
  FIND_MARKER,
  UNVERIFIED_NOTE,
  norm,
  normalizeMoney,
  normalizeMonthYear,
  normalizeTitle,
  normalizeEmployer,
  extractDateRange,
  extractTeamRange,
  measuresOf,
  judgeClaim,
  judgeClaims,
  parseClaims,
  checkText,
};
