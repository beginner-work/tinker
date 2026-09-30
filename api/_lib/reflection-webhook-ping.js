/* Debounced fire-and-forget reflection_saved POSTs. Failures never block saves. */
"use strict";
const store = require("./reflection-webhook-store.js");
const DEBOUNCE_MS = 2 * 60 * 1000;
const TIMEOUT_MS = 2500;
const timers = new Map();

function toIso(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
  }
  const d = new Date(value == null ? Date.now() : value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}
function normalizePayload(input) {
  if (!input || typeof input !== "object") return null;
  const reflectionId = String(input.reflectionId || input.id || "").trim();
  if (!reflectionId) return null;
  return {
    event: "reflection_saved",
    reflectionId,
    title: String(input.title == null ? "" : input.title),
    updatedAt: toIso(input.updatedAt || input.createdAt),
  };
}
async function postOnce(userId, payload) {
  const secrets = await store.getSecrets({ userId });
  if (!secrets) return { skipped: true };
  const controller = new AbortController();
  const timer = setTimeout(() => { try { controller.abort(); } catch { /* ignore */ } }, TIMEOUT_MS);
  try {
    const res = await fetch(secrets.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: secrets.authorization },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    await store.patchMeta({ userId, lastPingAt: new Date().toISOString(), pending: null });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err && err.name === "AbortError" ? "timeout" : "network" };
  } finally { clearTimeout(timer); }
}
async function flush(userId) {
  timers.delete(userId);
  try {
    const secrets = await store.getSecrets({ userId });
    if (!secrets || !secrets.pending) return;
    const payload = normalizePayload(secrets.pending);
    if (!payload) { await store.patchMeta({ userId, pending: null }); return; }
    await postOnce(userId, payload);
  } catch { /* ignore */ }
}
function notifyReflectionSaved(userId, reflection) {
  const payload = normalizePayload(reflection);
  if (!userId || !payload) return Promise.resolve({ skipped: true });
  return (async () => {
    try {
      if (!(await store.getSecrets({ userId }))) return { skipped: true, reason: "unset" };
      await store.patchMeta({ userId, pending: payload });
      const existing = timers.get(userId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => { void flush(userId); }, DEBOUNCE_MS);
      if (typeof timer.unref === "function") timer.unref();
      timers.set(userId, timer);
      return { scheduled: true, reflectionId: payload.reflectionId };
    } catch { return { skipped: true, reason: "error" }; }
  })();
}
async function flushNow(userId) {
  const existing = timers.get(userId);
  if (existing) clearTimeout(existing);
  timers.delete(userId);
  await flush(userId);
}
function resetTimers() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}
function latestFromBlob(data) {
  if (!Array.isArray(data) || !data.length) return null;
  let best = null; let bestTs = -1;
  for (const row of data) {
    if (!row || !row.id) continue;
    const ts = Date.parse(toIso(row.updatedAt || row.createdAt)) || 0;
    if (ts >= bestTs) { bestTs = ts; best = row; }
  }
  if (!best) return null;
  let title = best.title;
  if ((title == null || title === "") && best.stitched && best.stitched.title) title = best.stitched.title;
  return { reflectionId: best.id, title: title == null ? "" : title, updatedAt: best.updatedAt || best.createdAt };
}
module.exports = {
  DEBOUNCE_MS, TIMEOUT_MS, notifyReflectionSaved, flushNow, resetTimers, latestFromBlob, normalizePayload,
};
