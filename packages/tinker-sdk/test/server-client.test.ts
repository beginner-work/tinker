import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { TinkerClient, createTinkerClient } from "../src/server/client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("TinkerClient", () => {
  test("requires serviceToken", () => {
    assert.throws(() => new TinkerClient({ serviceToken: "" }), /serviceToken/);
  });

  test("createTinkerClient sets caller and baseUrl", () => {
    const client = createTinkerClient({
      serviceToken: "tok",
      caller: "example.com",
      baseUrl: "https://tinker.beginner.work/",
    });
    assert.equal(client.caller, "example.com");
    assert.equal(client.baseUrl, "https://tinker.beginner.work");
  });

  test("transcribe posts multipart with auth headers", async () => {
    const seen: { url?: string; headers?: Headers; form?: FormData } = {};
    const client = new TinkerClient({
      serviceToken: "secret-token",
      caller: "demo.dev",
      fetch: (async (url, init) => {
        seen.url = String(url);
        seen.headers = new Headers(init?.headers || {});
        seen.form = init?.body as FormData;
        return jsonResponse(200, {
          text: "hello",
          words: [{ text: "hello", start: 0, end: 0.3 }],
          durationMs: 300,
          requestId: "r1",
        });
      }) as typeof fetch,
    });

    const result = await client.transcribe({
      audio: Buffer.from([1, 2, 3]),
      mimeType: "audio/webm",
    });

    assert.equal(seen.url, "https://tinker.beginner.work/api/transcribe");
    assert.equal(seen.headers?.get("Authorization"), "Bearer secret-token");
    assert.equal(seen.headers?.get("X-Tinker-Caller"), "demo.dev");
    assert.ok(seen.form instanceof FormData);
    assert.equal(result.text, "hello");
    assert.equal(result.requestId, "r1");
    assert.equal(result.durationMs, 300);
  });

  test("ask posts JSON and returns audio", async () => {
    const seen: { url?: string; body?: string; headers?: Headers } = {};
    const client = new TinkerClient({
      serviceToken: "secret-token",
      caller: "demo.dev",
      fetch: (async (url, init) => {
        seen.url = String(url);
        seen.headers = new Headers(init?.headers || {});
        seen.body = String(init?.body || "");
        return jsonResponse(200, {
          answerText: "I think we learn by making.",
          audio: Buffer.from("mp3").toString("base64"),
          requestId: "a1",
          latencyMs: 42,
          label: "Tyler's agent",
        });
      }) as typeof fetch,
    });

    const result = await client.ask({
      question: "How do humans learn?",
      input: "typed",
      sourceId: "lindowlabs-minds-and-models",
      position: { paragraph: 13 },
    });

    assert.equal(seen.url, "https://tinker.beginner.work/api/ask");
    assert.equal(seen.headers?.get("Content-Type"), "application/json");
    const parsed = JSON.parse(seen.body || "{}");
    assert.equal(parsed.sourceId, "lindowlabs-minds-and-models");
    assert.equal(parsed.position.paragraph, 13);
    assert.equal(result.answerText, "I think we learn by making.");
    assert.ok(result.audio);
    assert.equal(result.label, "Tyler's agent");
  });

  test("ask surfaces upstream errors with status", async () => {
    const client = new TinkerClient({
      serviceToken: "secret-token",
      fetch: (async () =>
        jsonResponse(401, { error: "Unauthorized", requestId: "x" })) as typeof fetch,
    });
    await assert.rejects(
      () =>
        client.ask({
          question: "hi",
          input: "typed",
          sourceId: "lindowlabs-minds-and-models",
        }),
      (err: Error & { status?: number; requestId?: string }) => {
        assert.equal(err.message, "Unauthorized");
        assert.equal(err.status, 401);
        assert.equal(err.requestId, "x");
        return true;
      },
    );
  });

  test("ask validates input fields", async () => {
    const client = new TinkerClient({ serviceToken: "tok" });
    await assert.rejects(() => client.ask({ question: "", input: "typed", sourceId: "s" }), /question/);
    await assert.rejects(
      () => client.ask({ question: "q", input: "typed", sourceId: "" }),
      /sourceId/,
    );
  });
});
