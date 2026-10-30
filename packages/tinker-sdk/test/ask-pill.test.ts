import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "./jsdom-shim";
import { TinkerAsk } from "../src/browser/ask-pill";
import { __resetAskPillStylesForTests } from "../src/browser/styles";

describe("TinkerAsk helpers", () => {
  test("joinUrl trims slashes", () => {
    assert.equal(TinkerAsk._joinUrl("/api/tinker/", "/ask"), "/api/tinker/ask");
    assert.equal(TinkerAsk._joinUrl("/api/tinker", "transcribe"), "/api/tinker/transcribe");
  });

  test("extensionForMime maps common types", () => {
    assert.equal(TinkerAsk._extensionForMime("audio/webm;codecs=opus"), "webm");
    assert.equal(TinkerAsk._extensionForMime("audio/ogg"), "ogg");
    assert.equal(TinkerAsk._extensionForMime("audio/mp4"), "mp4");
  });
});

describe("TinkerAsk.create", () => {
  let dom: JSDOM;

  beforeEach(() => {
    __resetAskPillStylesForTests();
    dom = new JSDOM("<!doctype html><html><body><audio id='talk'></audio></body></html>", {
      url: "https://example.test/",
    });
    (globalThis as { window?: Window; document?: Document }).window = dom.window as unknown as Window;
    (globalThis as { document?: Document }).document = dom.window.document;
  });

  afterEach(() => {
    dom.window.close();
    delete (globalThis as { window?: Window }).window;
    delete (globalThis as { document?: Document }).document;
  });

  test("requires proxyUrl and sourceId", () => {
    assert.throws(
      () => TinkerAsk.create({ proxyUrl: "", sourceId: "s" } as never),
      /proxyUrl/,
    );
    assert.throws(
      () => TinkerAsk.create({ proxyUrl: "/api/tinker", sourceId: "" } as never),
      /sourceId/,
    );
  });

  test("mounts floating pill and opens panel", () => {
    const calls: string[] = [];
    const handle = TinkerAsk.create({
      proxyUrl: "/api/tinker",
      sourceId: "lindowlabs-minds-and-models",
      audioElement: "#talk",
      onPause: () => calls.push("pause"),
      onResume: () => calls.push("resume"),
    });

    const pill = document.querySelector(".tinker-ask__pill");
    assert.ok(pill);
    assert.equal(handle.getState(), "idle");

    handle.open();
    assert.equal(handle.getState(), "open");
    assert.ok(document.querySelector(".tinker-ask--open"));
    assert.deepEqual(calls, ["pause"]);

    handle.close();
    assert.equal(handle.getState(), "idle");
    assert.ok(calls.includes("resume"));

    handle.destroy();
    assert.equal(document.querySelector(".tinker-ask"), null);
  });

  test("typed submit posts to proxy ask URL", async () => {
    const seen: { url?: string; body?: string } = {};
    const handle = TinkerAsk.create({
      proxyUrl: "/api/tinker",
      sourceId: "lindowlabs-minds-and-models",
      defaultMode: "typed",
      fetch: (async (url, init) => {
        seen.url = String(url);
        seen.body = String(init?.body || "");
        return new Response(
          JSON.stringify({
            answerText: "We make to learn.",
            audio: "",
            requestId: "a1",
            latencyMs: 10,
            label: "Tyler's agent",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch,
    });

    handle.open();
    handle.setTranscript("How do humans learn?");
    await handle.submit();

    assert.equal(seen.url, "/api/tinker/ask");
    const parsed = JSON.parse(seen.body || "{}");
    assert.equal(parsed.question, "How do humans learn?");
    assert.equal(parsed.input, "typed");
    assert.equal(parsed.sourceId, "lindowlabs-minds-and-models");
    assert.match(document.querySelector(".tinker-ask__answer")?.textContent || "", /make to learn/);
    handle.destroy();
  });

  test("editable transcript is readable via getTranscript", () => {
    const handle = TinkerAsk.create({
      proxyUrl: "/api/tinker",
      sourceId: "lindowlabs-minds-and-models",
    });
    handle.setTranscript("  edited question  ");
    assert.equal(handle.getTranscript(), "  edited question  ");
    handle.destroy();
  });
});
