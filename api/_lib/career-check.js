/* check_text comparator.
 *
 * A model may list the claims in a draft. This file decides every
 * verdict. Numbers, dates, titles, and employer names are normalized
 * and compared exactly here. A verdict field on a claim is ignored.
 *
 * ready is true only when every claim is a pass. An empty draft, or a
 * draft that yields no claims, is not ready.
 * A title passes only when the employer on that same fact matches.
 * Baseline and mechanism claims compare amount, percentage, and baseline.
 */

"use strict";

const { callAnthropic } = require("./anthropic.js");
const {
  SENSITIVE_PATTERNS,
  UNVERIFIED_NOTE,
  SEED_RULES,
} = require("../../src/renderer/career/catalog.js");

const FIND_MODEL = "claude-opus-4-8";
const FIND_MARKER = "CAREER_CLAIM_FINDER";

const MONTH_LABELS = {
  "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun",
  "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
};

function formatMonthToken(iso) {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return "";
  const label = MONTH_LABELS[match[2]];
  if (!label) return "";
  return label + " " + match[1];
}

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
  MONTH_RE + "\\s+(\\d{4})\\s*(?:to|through|-|–|—)\\s*" + MONTH_RE + "\\s+(\\d{4})",
  "i",
);
const RANGE_PRESENT_RE = new RegExp(
  MONTH_RE + "\\s+(\\d{4})\\s*(?:to|through|-|–|—)\\s*(present|current)\\b",
  "i",
);
const KIND_ALIASES = {
  software_development: [
    "software development",
    "software engineering",
    "software engineer",
    "swe",
    "developer",
    "programming",
  ],
  management: [
    "management",
    "people management",
    "engineering management",
    "manager",
  ],
};

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
  const present = text.match(RANGE_PRESENT_RE);
  if (present) {
    const start = normalizeMonthYear(present[1] + " " + present[2]);
    if (!start) return null;
    return { start, end: "present", present: true };
  }
  const match = text.match(RANGE_RE);
  if (!match) return null;
  const start = normalizeMonthYear(match[1] + " " + match[2]);
  const end = normalizeMonthYear(match[3] + " " + match[4]);
  if (!start || !end) return null;
  return { start, end, present: false };
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
  const fromRecord = (record && record.rules || []).filter((rule) => rule && rule.status === "verified");
  const have = new Set(fromRecord.map((rule) => rule.id));
  const merged = fromRecord.slice();
  for (const seed of SEED_RULES) {
    if (have.has(seed.id)) continue;
    merged.push({ ...seed, status: "verified" });
  }
  return merged;
}

function ruleById(rules, id) {
  return rules.find((rule) => rule.id === id) || null;
}

function employmentFacts(facts) {
  return (facts || []).filter((fact) => fact && fact.kind === "employment" && fact.employer);
}

function hasCurrentEmployment(facts) {
  return employmentFacts(facts).some((fact) => fact.current === true);
}

function employmentRangeLabel(fact) {
  const start = formatMonthToken(fact.start_month) || fact.start_month;
  if (fact.current || !fact.end_month) return start + " - Present";
  const end = formatMonthToken(fact.end_month) || fact.end_month;
  return start + " - " + end;
}

function employmentCorrect(fact) {
  const parts = [fact.employer];
  if (fact.title) parts.push(fact.title);
  parts.push(employmentRangeLabel(fact));
  return parts.join(", ");
}

function mentionsPresent(value) {
  return /\b(present|current)\b/.test(norm(value));
}

function currentEmploymentIntent(claim, context) {
  const labels = labelBlob(claim, context);
  const text = norm(claim && claim.text);
  if (/current employer|current company|current employment/.test(labels)) return "field";
  if (mentionsPresent(text) && (claim && (claim.kind === "dates" || claim.kind === "employment" || claim.kind === "employer" || !claim.kind || claim.kind === "other"))) {
    return "present";
  }
  return "";
}

function kindFromTitle(title) {
  const text = normalizeTitle(title);
  const kinds = [];
  if (/\b(software|developer|swe|programmer|engineer)\b/.test(text)) kinds.push("software_development");
  if (/\b(manager|management|director|lead)\b/.test(text)) kinds.push("management");
  return kinds;
}

function entryKinds(fact) {
  const listed = Array.isArray(fact.experience_kinds) ? fact.experience_kinds.slice() : [];
  for (const kind of kindFromTitle(fact.title || "")) {
    if (!listed.includes(kind)) listed.push(kind);
  }
  return listed;
}

function normalizeExperienceKind(raw) {
  const text = norm(raw).replace(/-/g, " ");
  if (!text) return "";
  for (const [kind, aliases] of Object.entries(KIND_ALIASES)) {
    if (aliases.some((alias) => text.includes(alias))) return kind;
  }
  if (/\bsoftware\b/.test(text) && /\b(develop|engineer)/.test(text)) return "software_development";
  return text.replace(/\s+/g, "_");
}

function extractYearsThreshold(claim, context) {
  const blob = [
    context && context.field_label,
    claim && claim.field,
    claim && claim.text,
  ].filter(Boolean).join(" ");
  const folded = norm(blob);
  let match = folded.match(/\b(\d+)\s*\+\s*years?\b/);
  if (!match) match = folded.match(/\b(\d+)\s*\+\s*years?\s+of\b/);
  if (!match) match = folded.match(/\b(?:at least|more than|over)\s+(\d+)\s+years?\b/);
  if (!match) match = folded.match(/\b(\d+)\s+years?\s+of\b/);
  if (!match) match = folded.match(/\bdo you have\s+(\d+)\+?\s+years?\b/);
  if (!match) return null;
  const years = Number(match[1]);
  if (!Number.isFinite(years) || years <= 0) return null;
  const kindMatch = folded.match(/\byears?\s+of\s+(.+?)(?:\s+experience)?\s*\??$/)
    || folded.match(/\b(\d+)\s*\+\s*years?\s+of\s+(.+?)(?:\s+experience)?/);
  let kindRaw = "";
  if (kindMatch) {
    kindRaw = kindMatch[kindMatch.length - 1] || "";
    kindRaw = kindRaw.replace(/\bexperience\b/g, "").replace(/\?$/g, "").trim();
  }
  return {
    years,
    kind: normalizeExperienceKind(kindRaw),
    kindRaw: kindRaw,
  };
}

function yearsIntent(claim, context) {
  return extractYearsThreshold(claim, context) != null;
}

function yesNoAnswer(text) {
  const value = norm(labeledValue(text));
  if (!value) return "";
  if (value === "yes" || value === "y" || value === "true") return "yes";
  if (value === "no" || value === "n" || value === "false") return "no";
  if (/^\d+\+?\s*years?\b/.test(value)) return "years_claim";
  return "";
}

function monthsBetween(startIso, endIso) {
  const start = monthIndex(startIso);
  const end = monthIndex(endIso);
  if (start == null || end == null || end < start) return null;
  return end - start + 1;
}

function totalEmploymentMonths(facts, kind) {
  const entries = employmentFacts(facts);
  if (!entries.length) {
    return { months: 0, matched: [], established: !kind };
  }
  if (kind) {
    const anyKinded = entries.some((fact) => entryKinds(fact).length > 0);
    if (!anyKinded) return { months: 0, matched: [], established: false };
    const matched = entries.filter((fact) => entryKinds(fact).includes(kind));
    if (!matched.length) return { months: 0, matched: [], established: false };
    let months = 0;
    for (const fact of matched) {
      if (!fact.start_month || fact.current || !fact.end_month) continue;
      const span = monthsBetween(fact.start_month, fact.end_month);
      if (span != null) months += span;
    }
    return { months, matched, established: true };
  }
  let months = 0;
  for (const fact of entries) {
    if (!fact.start_month || fact.current || !fact.end_month) continue;
    const span = monthsBetween(fact.start_month, fact.end_month);
    if (span != null) months += span;
  }
  return { months, matched: entries, established: true };
}

function findEmploymentForClaim(text, facts) {
  const foldedEmployer = normalizeEmployer(text);
  const entries = employmentFacts(facts);
  if (!entries.length) return null;
  const hits = entries.filter((fact) => {
    const employer = normalizeEmployer(fact.employer);
    return employer && foldedEmployer.includes(employer);
  });
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    hits.sort((a, b) => normalizeEmployer(b.employer).length - normalizeEmployer(a.employer).length);
    return hits[0];
  }
  return null;
}

function judgeCurrentEmployment(text, facts, rule, mode) {
  const current = hasCurrentEmployment(facts);
  if (mode === "field") {
    if (!current && (blankish(text) || !normalizeEmployer(labeledValue(text)))) {
      return pass(text, rule.id);
    }
    if (!current) return mismatch(text, rule.id, "");
    const entry = employmentFacts(facts).find((fact) => fact.current);
    const want = entry ? entry.employer : "";
    if (normalizeEmployer(labeledValue(text)) === normalizeEmployer(want)) return pass(text, rule.id);
    return mismatch(text, rule.id, want);
  }
  if (mentionsPresent(text) && !current) {
    return mismatch(text, rule.id, "");
  }
  return null;
}

function judgeYearsExperience(text, claim, context, facts, rule, claire) {
  const threshold = extractYearsThreshold(claim, context);
  if (!threshold) return null;
  const totals = totalEmploymentMonths(facts, threshold.kind || "");
  if (threshold.kind && !totals.established) {
    return needsClaire(text, claire && claire.id);
  }
  const enough = totals.months >= threshold.years * 12;
  const answer = yesNoAnswer(text);
  if (answer === "yes") {
    if (enough) return pass(text, rule.id);
    return mismatch(text, rule.id, "No");
  }
  if (answer === "no") {
    if (!enough) return pass(text, rule.id);
    return mismatch(text, rule.id, "Yes");
  }
  const claimedYears = extractMoreThanYears(text);
  const plus = norm(text).match(/\b(\d+)\s*\+\s*years?\b/);
  const claimed = plus ? Number(plus[1]) : claimedYears;
  if (claimed != null && Number.isFinite(claimed)) {
    if (enough && claimed <= Math.floor(totals.months / 12)) return pass(text, rule.id);
    if (!enough && claimed >= threshold.years) {
      return mismatch(text, rule.id, "No");
    }
  }
  if (enough) return pass(text, rule.id);
  return mismatch(text, rule.id, "No");
}

function judgeEmploymentDates(text, facts, rule) {
  const claimRange = extractDateRange(text);
  const entry = findEmploymentForClaim(text, facts);
  if (!entry) {
    if (!claimRange) return null;
    return unsupported(text);
  }
  const correct = employmentCorrect(entry);
  if (claimRange && claimRange.present) {
    if (entry.current) {
      if (claimRange.start === entry.start_month) return pass(text, rule.id);
      return mismatch(text, rule.id, correct);
    }
    return mismatch(text, rule.id, correct);
  }
  if (!claimRange) return null;
  if (entry.current) return mismatch(text, rule.id, correct);
  if (claimRange.start === entry.start_month && claimRange.end === entry.end_month) {
    return pass(text, rule.id);
  }
  return mismatch(text, rule.id, correct);
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

function mentionsBaseline(text) {
  return /\b(baseline|mechanism)\b/.test(norm(text));
}

function isBaselineFact(fact) {
  if (!fact || fact.kind !== "metric") return false;
  if (mentionsBaseline(fact.value)) return true;
  if (typeof fact.baseline === "string" && fact.baseline.trim()) return true;
  if (typeof fact.mechanism === "string" && fact.mechanism.trim()) return true;
  return false;
}

function canonicalPercent(raw) {
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return "";
  return String(amount) + "%";
}

function canonicalAmounts(text) {
  const raw = String(text || "");
  const folded = norm(raw);
  const found = new Set();
  for (const match of folded.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
    const token = canonicalPercent(match[1]);
    if (token) found.add(token);
  }
  const money = /\$\s*\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*[kmb]?|\b\d+(?:\.\d+)?\s*[kmb]\b/gi;
  for (const match of raw.matchAll(money)) {
    const token = normalizeMoney(match[0]);
    if (token) found.add(token);
  }
  return [...found].sort();
}

function factAmounts(fact) {
  const parts = [fact.value, fact.baseline, fact.mechanism].filter((part) => {
    return typeof part === "string" && part.trim();
  });
  return canonicalAmounts(parts.join(" "));
}

function sameAmountSet(left, right) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function amountSubject(text) {
  const raw = String(text || "");
  const folded = norm(raw);
  const money = /\$\s*\d/.test(raw) || /\b\d+(?:\.\d+)?\s*[kmb]\b/.test(folded) || /\bgmv\b/.test(folded);
  const percent = /\d+(?:\.\d+)?\s*%/.test(folded) || /\bavailability\b/.test(folded);
  if (money && percent) return "mixed";
  if (money) return "money";
  if (percent) return "percent";
  return "";
}

function subjectsCompatible(claimText, fact) {
  const claim = amountSubject(claimText);
  const factBlob = [fact.value, fact.baseline, fact.mechanism].filter((part) => part != null).join(" ");
  const factSubject = amountSubject(factBlob);
  if (!claim || !factSubject || claim === "mixed" || factSubject === "mixed") return true;
  return claim === factSubject;
}

function baselineCorrect(fact) {
  const parts = [];
  if (fact.value) parts.push(String(fact.value));
  if (typeof fact.baseline === "string" && fact.baseline.trim()) parts.push("baseline " + fact.baseline.trim());
  if (typeof fact.mechanism === "string" && fact.mechanism.trim()) parts.push("mechanism " + fact.mechanism.trim());
  return parts.join("; ");
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
    if (start == null || end == null || range.present) return unsupported(text);
    const span = end - start;
    if (span > years * 12) return pass(text, remote.id);
    return mismatch(text, remote.id, remote.value);
  }
  const claimRange = extractDateRange(text);
  if (claimRange && !claimRange.present) {
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
    if (best) {
      const factRange = extractDateRange(best.value);
      if (factRange.start === claimRange.start && factRange.end === claimRange.end) return pass(text, best.id);
      return mismatch(text, best.id, best.value);
    }
  }
  const employmentRule = { id: "rule_employer_dates" };
  return judgeEmploymentDates(text, facts, employmentRule);
}

function employerToken(text) {
  return normalizeEmployer(text);
}

function judgeTitle(text, facts) {
  const claimTitle = titleOf(text);
  const claimEmployer = employerOf(text);
  const hits = facts.filter((fact) => {
    if (fact.kind !== "title" || !fact.value) return false;
    const title = titleOf(fact.value);
    return title && claimTitle.includes(title);
  });
  if (!hits.length) return unsupported(text);
  hits.sort((a, b) => titleOf(b.value).length - titleOf(a.value).length);
  const aligned = hits.find((fact) => {
    const employer = employerOf(fact.value);
    return employer && claimEmployer === employer;
  });
  if (aligned) return pass(text, aligned.id);
  const best = hits[0];
  const employer = employerOf(best.value);
  if (!employer && !claimEmployer) return pass(text, best.id);
  return mismatch(text, best.id, best.value);
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

function judgeBaseline(text, facts) {
  const candidates = facts.filter((fact) => isBaselineFact(fact) && subjectsCompatible(text, fact));
  if (!candidates.length) return unsupported(text);
  const claimSet = canonicalAmounts(text);
  const exact = candidates.find((fact) => sameAmountSet(claimSet, factAmounts(fact)));
  if (exact) return pass(text, exact.id);
  let best = candidates[0];
  let bestOverlap = -1;
  for (const fact of candidates) {
    const overlap = factAmounts(fact).filter((token) => claimSet.includes(token)).length;
    if (overlap > bestOverlap) {
      best = fact;
      bestOverlap = overlap;
    }
  }
  return mismatch(text, best.id, baselineCorrect(best));
}

function judgeMetric(text, facts) {
  if (mentionsBaseline(text)) return judgeBaseline(text, facts);
  const claimMeasures = measuresOf(text);
  const claimNorm = norm(text);
  let partial = null;
  for (const fact of facts) {
    if (fact.kind !== "metric") continue;
    if (isBaselineFact(fact)) continue;
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
  if (yearsIntent(claim, context)) return false;
  if (currentEmploymentIntent(claim, context) === "field") return false;
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

  if (yearsIntent(claim, context)) {
    const rule = ruleById(rules, "rule_years_experience");
    if (!rule) return needsClaire(text, claire && claire.id);
    return judgeYearsExperience(text, claim, context, facts, rule, claire);
  }

  const kind = claim && claim.kind;
  if (kind === "dates" || kind === "employment") {
    const dateRule = ruleById(rules, "rule_employer_dates") || { id: "rule_employer_dates" };
    if (kind === "employment") {
      const byEmployment = judgeEmploymentDates(text, facts, dateRule);
      if (byEmployment) return byEmployment;
    } else {
      const judged = judgeDates(text, facts);
      if (judged) {
        if (judged.id === "rule_employer_dates" && dateRule.id) judged.id = dateRule.id;
        return judged;
      }
    }
  }

  const currentEmp = currentEmploymentIntent(claim, context);
  if (currentEmp) {
    const rule = ruleById(rules, "rule_current_employment");
    if (!rule) return needsClaire(text, claire && claire.id);
    const judged = judgeCurrentEmployment(text, facts, rule, currentEmp);
    if (judged) return judged;
  }

  if (kind === "team_size") {
    const judged = judgeTeam(text, facts);
    if (judged) return judged;
  }
  if (kind === "metric") {
    const judged = judgeMetric(text, facts);
    if (judged) return judged;
  }
  if (kind === "title") return judgeTitle(text, facts);
  if (kind === "employer") {
    const dateRule = ruleById(rules, "rule_employer_dates");
    if (dateRule && extractDateRange(text)) {
      const byEmployment = judgeEmploymentDates(text, facts, dateRule);
      if (byEmployment) return byEmployment;
    }
    return judgeEmployer(text, facts);
  }
  if (kind === "degree") return judgeDegree(text, facts);
  if (kind === "location") return judgeLocationFact(text, facts);

  if (!kind || kind === "other" || kind === "story") {
    if (extractDateRange(text)) {
      const judged = judgeDates(text, facts);
      if (judged) return judged;
    }
    const metric = judgeMetric(text, facts);
    if (metric) return metric;
    const team = judgeTeam(text, facts);
    if (team) return team;
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
  "Return JSON only: {\"claims\":[{\"text\":\"...\",\"kind\":\"employer|title|dates|team_size|location|metric|degree|contact|story|salary|employment|other\",\"field\":\"\"}]}",
  "Copy each claim's text from the draft. Do not decide whether a claim is true.",
  "Do not include a verdict. kind is a label only.",
  "Split team sizes, dates, titles, employers, employment date ranges, years of experience answers, metrics, locations, salary, and sensitive answers into separate claims.",
  "If a draft uses Present or current for employment dates, include that claim with kind dates.",
  "If the draft answers a years-of-experience question, include the answer and put the question text in field.",
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

function usableClaims(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((claim) => claim && String(claim.text || "").trim());
}

function notReady(reason) {
  return {
    ready: false,
    claims: [],
    reason,
    unverified_note: UNVERIFIED_NOTE,
  };
}

async function checkText({ record, text, company, field_label, findClaims }) {
  const draft = typeof text === "string" ? text : "";
  const context = {
    field_label: typeof field_label === "string" ? field_label : "",
    company: typeof company === "string" ? company : "",
  };
  let found = [];
  if (!draft.trim() && !context.field_label) return notReady("No draft to check.");
  if (!draft.trim()) {
    found = [{ text: "", kind: "", field: context.field_label }];
  } else {
    const finder = findClaims || defaultFindClaims;
    const listed = await finder({
      text: draft,
      company: context.company,
      field_label: context.field_label,
    });
    found = usableClaims(listed);
    if (!found.length) return notReady("No factual claims were found in the draft.");
  }
  const claims = judgeClaims(record, found, context);
  return {
    ready: claims.length > 0 && claims.every((claim) => claim.verdict === "pass"),
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
