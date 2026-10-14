"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createCodexExerciseRevisionService, validateRevision, validateInput, validPath, resolveCodexExecutable, LIMITS } = require("../src/main/lib/codex-exercise-revision.js");
const input = () => ({ exerciseId: "payments", exerciseName: "Payments", essayBody: "Practice idempotency.", files: [{ path: "README.md", content: "Old instructions" }] });
const revision = () => ({ steps: ["Add an idempotency key."], files: [{ path: "README.md", content: "# New exercise" }] });
function fakeSpawn(handler, calls) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.input = ""; child.kills = [];
    child.stdin.on("data", chunk => { child.input += chunk.toString(); });
    child.kill = signal => { child.kills.push(signal); setImmediate(() => child.emit("close", null)); return true; };
    calls.push({ command, args, options, child });
    child.stdin.on("finish", () => setImmediate(() => handler(child, args, options)));
    return child;
  };
}
function auth(child) { child.stderr.write("Logged in using ChatGPT\n"); child.emit("close", 0); }
function success(child, value = revision()) {
  child.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(value) } }) + "\n");
  child.stdout.write(JSON.stringify({ type: "turn.completed", usage: {} }) + "\n"); child.emit("close", 0);
}
async function fixture(t, handler = success, options = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "tinker-runtime-test-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const calls = [];
  const service = createCodexExerciseRevisionService({ codexHome: home, executable: "/test/codex", spawn: fakeSpawn((child, args, opts) => args[0] === "login" ? auth(child) : handler(child, args, opts), calls), ...options });
  return { service, calls, home };
}
test("successful revision uses isolated cwd, structured schema, ChatGPT and hardened CLI configuration", async t => {
  const { service, calls, home } = await fixture(t, async (child, args, opts) => {
    assert.deepEqual(JSON.parse(await fs.readFile(args[args.indexOf("--output-schema") + 1], "utf8")).required, ["steps", "files"]);
    assert.deepEqual(await fs.readdir(opts.cwd), ["revision-schema.json"]);
    success(child);
  }, { env: { PATH: "/bin", HOME: "/home/test", OPENAI_API_KEY: "secret", CODEX_API_KEY: "secret2", NODE_OPTIONS: "evil", HTTPS_PROXY: "evil", OPENAI_BASE_URL: "evil", CODEX_HOME: "other" } });
  assert.deepEqual(await service.revise(input()), revision());
  assert.equal(calls.length, 2);
  const exec = calls[1];
  assert.equal(exec.options.shell, false);
  assert.equal(exec.options.env.CODEX_HOME, home);
  assert.deepEqual(Object.keys(exec.options.env).sort(), ["CODEX_HOME", "HOME", "NO_COLOR", "PATH"]);
  for (const value of ["--ignore-user-config", "--ignore-rules", "--ephemeral", "read-only", 'forced_login_method="chatgpt"', 'approval_policy="never"', 'web_search="disabled"', "features.shell_tool=false", "features.hooks=false", "mcp_servers={}"]) assert.ok(exec.args.includes(value), value);
  assert.equal(exec.args.at(-1), "-");
  assert.ok(exec.child.input.includes(input().essayBody));
  assert.ok(!exec.args.includes(input().essayBody));
  await assert.rejects(fs.stat(exec.options.cwd), { code: "ENOENT" });
});
test("status exposes only safe auth fields", async t => {
  const { service } = await fixture(t);
  const { setupCommand, setupShell, ...status } = await service.checkStatus();
  assert.deepEqual(status, { available: true, authenticated: true, authMethod: "chatgpt", code: "READY" });
  assert.equal(setupShell, "terminal");
  assert.match(setupCommand, /^env CODEX_HOME=/);
  assert.match(setupCommand, /forced_login_method="chatgpt"/);
  assert.ok(setupCommand.endsWith(" login"));
});
test("API-key login is rejected and never launches inference or exposes key", async t => {
  const calls = [];
  const { service } = await fixture(t, success, { spawn: fakeSpawn(child => { child.stderr.write("Logged in using an API key - sk-secret\n"); child.emit("close", 0); }, calls) });
  const status = await service.checkStatus();
  assert.equal(status.code, "CODEX_API_KEY_NOT_ALLOWED");
  assert.ok(!JSON.stringify(status).includes("sk-secret"));
  await assert.rejects(service.revise(input()), { code: "CODEX_API_KEY_NOT_ALLOWED" });
  assert.ok(calls.every(c => c.args[0] === "login"));
});
test("unknown and missing authentication fail closed", async t => {
  for (const [text, code] of [["Logged in using SomethingNew", 0], ["Not logged in", 1]]) {
    const { service } = await fixture(t, success, { spawn: fakeSpawn(child => { child.stderr.write(text); child.emit("close", code); }, []) });
    await assert.rejects(service.revise(input()), { code: "CODEX_SIGN_IN_REQUIRED" });
  }
});
test("missing executable is safely reported", async t => {
  const { service } = await fixture(t, success, { spawn: () => { throw Object.assign(new Error("private path"), { code: "ENOENT" }); } });
  assert.equal((await service.checkStatus()).code, "CODEX_NOT_INSTALLED");
  await assert.rejects(service.revise(input()), { code: "CODEX_NOT_INSTALLED" });
});
test("spawn error events are sanitized", async t => {
  const { service } = await fixture(t, success, { spawn: fakeSpawn(child => child.emit("error", Object.assign(new Error("secret"), { code: "ENOENT" })), []) });
  assert.equal((await service.checkStatus()).available, false);
});
test("failed CLI exit never returns raw stderr", async t => {
  const { service } = await fixture(t, child => { child.stderr.write("secret /private/file"); child.emit("close", 1); });
  await assert.rejects(service.revise(input()), e => e.code === "CODEX_FAILED" && !e.message.includes("secret"));
});
test("timeout kills child, cleans temporary directory and releases service", async t => {
  const { service, calls } = await fixture(t, () => {}, { timeoutMs: 15 });
  await assert.rejects(service.revise(input()), { code: "CODEX_TIMEOUT" });
  assert.deepEqual(calls[1].child.kills, ["SIGTERM"]);
  await assert.rejects(fs.stat(calls[1].options.cwd), { code: "ENOENT" });
  await assert.rejects(service.revise(input()), { code: "CODEX_TIMEOUT" });
});
test("cancel aborts in-flight revision and pre-aborted requests never spawn", async t => {
  const controller = new AbortController();
  const { service, calls } = await fixture(t, () => controller.abort());
  await assert.rejects(service.revise(input(), { signal: controller.signal }), { code: "CODEX_CANCELLED" });
  assert.deepEqual(calls[1].child.kills, ["SIGTERM"]);
  await assert.rejects(service.revise(input(), { signal: controller.signal }), { code: "CODEX_CANCELLED" });
  assert.equal(calls.length, 2);
});
test("concurrent revisions are refused", async t => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const controller = new AbortController();
  const { service } = await fixture(t, () => release());
  const pending = service.revise(input(), { signal: controller.signal });
  await ready;
  await assert.rejects(service.revise(input()), { code: "CODEX_BUSY" });
  controller.abort(); await assert.rejects(pending, { code: "CODEX_CANCELLED" });
});
test("bounded stdout and stderr stop runaway output", async t => {
  for (const stream of ["stdout", "stderr"]) {
    const { service, calls } = await fixture(t, child => child[stream].write("x".repeat(LIMITS.output + 1)));
    await assert.rejects(service.revise(input()), { code: "CODEX_OUTPUT_LIMIT" });
    assert.deepEqual(calls[1].child.kills, ["SIGTERM"]);
  }
});
test("tool attempt and turn failure abort", async t => {
  for (const [event, code] of [[{ type: "item.started", item: { type: "command_execution", command: "evil" } }, "CODEX_TOOL_ATTEMPT"], [{ type: "turn.failed", error: { message: "secret" } }, "CODEX_FAILED"]]) {
    const { service } = await fixture(t, child => child.stdout.write(JSON.stringify(event) + "\n"));
    await assert.rejects(service.revise(input()), { code });
  }
});
test("JSONL can split across chunks and final newline is optional", async t => {
  const { service } = await fixture(t, child => {
    const text = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(revision()) } }) + '\n{"type":"turn.completed"}';
    child.stdout.write(text.slice(0, 10)); child.stdout.write(text.slice(10)); child.emit("close", 0);
  });
  assert.deepEqual(await service.revise(input()), revision());
});
test("malformed JSONL, missing completion, fenced or invalid final JSON fail closed", async t => {
  const outputs = ["not JSON\n", '{"type":"turn.completed"}\n', JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(revision()) } }) + "\n", JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "```json {} ```" } }) + '\n{"type":"turn.completed"}\n'];
  for (const output of outputs) {
    const { service } = await fixture(t, child => { child.stdout.write(output); child.emit("close", 0); });
    await assert.rejects(service.revise(input()), { code: "CODEX_INVALID_OUTPUT" });
  }
});
test("strict result validation rejects extra fields, traversal, duplicates and excessive data", () => {
  const invalid = [null, {}, { ...revision(), extra: true }, { steps: [], files: [] }, { steps: [42], files: [] }, { steps: [" "], files: [] }, { steps: ["x".repeat(LIMITS.step + 1)], files: [] }, { steps: ["ok"], files: [{ path: "../secret", content: "bad" }] }, { steps: ["ok"], files: [{ path: "a.js", content: "a" }, { path: "A.js", content: "b" }] }, { steps: ["ok"], files: [{ path: "a", content: "x", extra: true }] }, { steps: ["ok"], files: [{ path: "a", content: "x".repeat(LIMITS.file + 1) }] }];
  for (const value of invalid) assert.throws(() => validateRevision(value), { code: "CODEX_INVALID_OUTPUT" });
});
test("paths reject OS-specific escapes and hidden configuration", () => {
  for (const p of ["/tmp/a", "C:/a", "a\\b", "a//b", "./a", "a/../b", ".env", "a/.codex/config.toml", "NUL", "aux.js", "a.", "a ", "a\0b"]) assert.equal(validPath(p), false, p);
  for (const p of ["README.md", "src/practice.ts", "fixtures/input.json"]) assert.equal(validPath(p), true, p);
});
test("input bounds and invalid input are checked before any subprocess", async t => {
  const { service, calls } = await fixture(t);
  for (const value of [{ ...input(), essayBody: "" }, { ...input(), essayBody: "x".repeat(LIMITS.essay + 1) }, { ...input(), files: [{ path: "../escape", content: "" }] }, { ...input(), files: Array(41).fill({ path: "a", content: "" }) }]) await assert.rejects(service.revise(value), { code: "CODEX_INVALID_INPUT" });
  assert.equal(calls.length, 0);
  assert.deepEqual(validateInput(input()), input());
});
test("dedicated home refuses custom configuration without reading it or launching CLI", async t => {
  const { service, calls, home } = await fixture(t);
  await fs.writeFile(path.join(home, "config.toml"), "private custom settings");
  assert.equal((await service.checkStatus()).code, "CODEX_UNSAFE_CONFIG");
  await assert.rejects(service.revise(input()), { code: "CODEX_UNSAFE_CONFIG" });
  assert.equal(calls.length, 0);
});

test("setup instructions quote paths and executables for each shell without executing login", async t => {
  const { home } = await fixture(t);
  const unusualHome = path.join(home, "quote' $folder");
  const calls = [];
  for (const platform of ["darwin", "win32"]) {
    const service = createCodexExerciseRevisionService({ codexHome: unusualHome, executable: "/a'b/codex", platform, spawn: fakeSpawn(auth, calls) });
    const status = await service.checkStatus();
    assert.equal(status.setupShell, platform === "win32" ? "powershell" : "terminal");
    assert.ok(status.setupCommand.includes(platform === "win32" ? "quote'' $folder" : "quote'\\'' $folder"));
  }
  assert.ok(calls.every(call => call.args.join(" ") === "login status"));
});

test("stubborn process gets SIGKILL after cancellation grace period", async t => {
  const calls = [];
  const { service } = await fixture(t, success, {
    timeoutMs: 10,
    spawn: fakeSpawn((child, args) => {
      if (args[0] === "login") return auth(child);
      child.kill = signal => { child.kills.push(signal); return true; };
    }, calls),
  });
  await assert.rejects(service.revise(input()), { code: "CODEX_TIMEOUT" });
  assert.deepEqual(calls[1].child.kills, ["SIGTERM", "SIGKILL"]);
});
test("authentication checks are time-bounded too", async t => {
  const { service } = await fixture(t, success, { statusTimeoutMs: 10, spawn: fakeSpawn(() => {}, []) });
  const status = await service.checkStatus();
  assert.equal(status.code, "CODEX_TIMEOUT");
  assert.equal(status.authenticated, false);
});
test("symlinked auth folder is rejected", async t => {
  if (process.platform === "win32") return t.skip("Symlink creation requires Windows privileges");
  const { home } = await fixture(t);
  const alias = path.join(home, "alias");
  await fs.symlink(home, alias);
  const service = createCodexExerciseRevisionService({ codexHome: alias, executable: "/test/codex", spawn: () => assert.fail("Must not launch") });
  assert.equal((await service.checkStatus()).code, "CODEX_UNSAFE_CONFIG");
});


test("input permits up to 40 exact files while output remains capped at 24", () => {
  const files = Array.from({ length: 40 }, (_, i) => ({ path: "file" + i + ".js", content: "stub" }));
  assert.equal(validateInput({ ...input(), files }).files.length, 40);
  assert.throws(() => validateRevision({ steps: ["ok"], files }), { code: "CODEX_INVALID_OUTPUT" });
});

async function installedNpmFixture(t, { platform, arch, layout = "bin", bundled = false, hoisted = false }) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "tinker-npm-layout-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, "lib", "node_modules", "@openai", "codex");
  const bin = path.join(base, "bin");
  await fs.mkdir(path.join(root, "bin"), { recursive: true });
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "@openai/codex", version: "0.122.0" }));
  await fs.writeFile(path.join(root, "bin", "codex.js"), "#!/usr/bin/env node\nthrow new Error('must never run wrapper');\n", { mode: 0o755 });
  await fs.symlink(path.join(root, "bin", "codex.js"), path.join(bin, "codex"));
  const triple = platform === "darwin" ? (arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin") : "x86_64-unknown-linux-musl";
  const vendor = bundled ? path.join(root, "vendor") : hoisted ? path.join(path.dirname(root), "codex-" + platform + "-" + arch, "vendor") : path.join(root, "node_modules", "@openai", "codex-" + platform + "-" + arch, "vendor");
  const native = path.join(vendor, triple, layout, "codex");
  await fs.mkdir(path.dirname(native), { recursive: true });
  await fs.writeFile(native, platform === "darwin" ? Buffer.from("cffaedfe00000000", "hex") : Buffer.from("7f454c4600000000", "hex"), { mode: 0o755 });
  return { base, root, bin, native };
}
test("macOS npm symlink resolves native optional dependency with no node on GUI PATH", async t => {
  const fixture = await installedNpmFixture(t, { platform: "darwin", arch: "arm64" });
  const fsSync = require("node:fs");
  // Mirror Finder's fixed Homebrew path onto the fixture's real symlink tree.
  const adapted = Object.create(fsSync);
  const mapped = p => p.startsWith("/opt/homebrew/bin/") ? path.join(fixture.bin, path.basename(p)) : p;
  for (const name of ["accessSync", "statSync", "openSync", "realpathSync"]) adapted[name] = (p, ...args) => fsSync[name](mapped(p), ...args);
  assert.equal(resolveCodexExecutable({ platform: "darwin", arch: "arm64", env: { PATH: "/usr/bin:/bin" }, filesystem: adapted }), fixture.native);
});
test("Linux npm supports hoisted optional dependency and older bundled native layouts", async t => {
  for (const config of [{ hoisted: true }, { bundled: true, layout: "codex" }]) {
    const fixture = await installedNpmFixture(t, { platform: "linux", arch: "x64", ...config });
    assert.equal(resolveCodexExecutable({ platform: "linux", arch: "x64", env: { PATH: ":.:relative:" + fixture.bin } }), fixture.native);
  }
});
test("npm wrapper with missing native dependency fails closed instead of invoking node", async t => {
  const fixture = await installedNpmFixture(t, { platform: "linux", arch: "x64" });
  await fs.unlink(fixture.native);
  assert.equal(resolveCodexExecutable({ platform: "linux", arch: "x64", env: { PATH: fixture.bin } }), null);
});
test("package identity and native executable magic are checked", async t => {
  const fixture = await installedNpmFixture(t, { platform: "linux", arch: "x64" });
  await fs.writeFile(fixture.native, "#!/bin/sh\necho wrapper\n");
  assert.equal(resolveCodexExecutable({ platform: "linux", arch: "x64", env: { PATH: fixture.bin } }), null);
  await fs.writeFile(fixture.native, Buffer.from("7f454c4600000000", "hex"));
  await fs.writeFile(path.join(fixture.root, "package.json"), JSON.stringify({ name: "unrelated" }));
  assert.equal(resolveCodexExecutable({ platform: "linux", arch: "x64", env: { PATH: fixture.bin } }), null);
});
test("Windows npm cmd/ps1 tree resolves native exe without executing a shell", async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "tinker-windows-npm-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const appData = "C:\\Users\\Tyler\\AppData\\Roaming";
  const npm = path.win32.join(appData, "npm");
  const root = path.win32.join(npm, "node_modules", "@openai", "codex");
  const native = path.win32.join(root, "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
  const mapped = p => path.join(base, p.replace(/:/g, "").replace(/\\/g, "/"));
  await fs.mkdir(path.dirname(mapped(native)), { recursive: true });
  await fs.mkdir(mapped(root), { recursive: true });
  await fs.writeFile(mapped(path.win32.join(npm, "codex.cmd")), "@node codex.js");
  await fs.writeFile(mapped(path.win32.join(npm, "codex.ps1")), "& node codex.js");
  await fs.writeFile(mapped(path.win32.join(root, "package.json")), JSON.stringify({ name: "@openai/codex" }));
  await fs.writeFile(mapped(native), Buffer.from("4d5a000000000000", "hex"), { mode: 0o755 });
  const fsSync = require("node:fs");
  const adapted = Object.create(fsSync);
  for (const name of ["accessSync", "statSync", "openSync", "realpathSync", "readFileSync"]) adapted[name] = (p, ...args) => fsSync[name](mapped(p), ...args);
  assert.equal(resolveCodexExecutable({ platform: "win32", arch: "x64", env: { APPDATA: appData, PATH: "C:\\Windows\\System32" }, filesystem: adapted }), native);
});
test("relative PATH and unsupported architectures never discover executables", () => {
  assert.equal(resolveCodexExecutable({ platform: "linux", arch: "x64", env: { PATH: ".:relative:" } }), null);
  assert.equal(resolveCodexExecutable({ platform: "linux", arch: "unknown", env: { PATH: "/usr/bin" } }), null);
});
