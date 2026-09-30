"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const od = require("../src/renderer/on-device-llm.js");
const { KEEP_CRAFTING_MODEL } = require("../api/_lib/keep-crafting-model.js");
const composer = fs.readFileSync(path.join(root, "src/renderer/messages-composer.js"), "utf8");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");

test("Gemma 3n E2B download size matches LiteRT-LM table (~2965 MB)", () => {
  assert.equal(od.GEMMA_3N_E2B.downloadMb, 2965);
  assert.ok(od.GEMMA_3N_E2B.downloadMb > od.GEMMA_3N_E2B.iosSafariTabBudgetMb);
});

test("fallback model matches KEEP_CRAFTING_MODEL (Opus)", () => {
  assert.equal(od.FALLBACK_MODEL, "claude-opus-4-8");
  assert.equal(od.fallbackModel(), KEEP_CRAFTING_MODEL);
});

test("evaluateGemma3nE2B refuses without WebGPU in Node", () => {
  const gate = od.evaluateGemma3nE2B();
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /webgpu-unavailable|gemma-3n-e2b-not-wired|ios-safari-memory/);
  assert.equal(gate.fallbackModel, "claude-opus-4-8");
});

test("resolveKeepCraftingPath falls back to Opus", () => {
  const pathInfo = od.resolveKeepCraftingPath();
  assert.equal(pathInfo.mode, "fallback");
  assert.equal(pathInfo.model, "claude-opus-4-8");
});

test("generateKeepCrafting rejects so callers use Opus", async () => {
  await assert.rejects(() => od.generateKeepCrafting("prompt"), /unavailable|webgpu|ios-safari|not-wired/i);
});

test("composer wires on-device gate then KEEP_CRAFTING_MODEL fallback", () => {
  assert.match(composer, /tinkerOnDeviceLlm/);
  assert.match(composer, /canRunGemma3nE2B/);
  assert.match(composer, /keepCraftingModelId|fallbackModel/);
  assert.match(composer, /viaFallbackModel/);
});

test("index.html loads on-device-llm.js before messages-composer.js", () => {
  const odIdx = html.indexOf("on-device-llm.js");
  const composerIdx = html.indexOf("messages-composer.js");
  assert.ok(odIdx > 0 && composerIdx > odIdx);
});

test("service worker precaches on-device-llm.js and bumps cache", () => {
  assert.match(sw, /\/on-device-llm\.js/);
  assert.match(sw, /tinker-shell-v14/);
});
