/* tinker — phone/PIN auth gate
 *
 * On the plain web build (the one served by src/web/server.js) we put a
 * sign-in screen in front of the renderer until the user has a Stytch
 * session token for the Claude proxy. The token is stored under
 * `tinker_jwt` in localStorage (legacy key — the value is now Stytch's
 * long-lived `session_token`, not a JWT) so the platform-mobile shim
 * can read it for proxied Claude calls. Validation happens server-side
 * on every request via Stytch's /sessions/authenticate, so there is no
 * client-side `exp` to check — the server is the source of truth.
 *
 * On Electron desktop this file is loaded too but the gate is
 * skipped — desktop already has its own ANTHROPIC_API_KEY env var.
 * Only the plain web build (`html.on-web` and
 * `window.tinker.platform === "web"`) shows the gate.
 */

(function () {
  "use strict";

  const TOKEN_KEY = "tinker_jwt";
  const PHONE_KEY = "tinker_phone";
  const PHONE_ID_KEY = "tinker_phone_id";

  // ── Platform detection ───────────────────────────────────────────────
  //
  // The platform-mobile shim adds .on-web to <html> on plain web; Electron
  // has its own window.tinker so we can also check that as a backstop.

  function isWebPlatform() {
    if (window.tinker && window.tinker.supportsWebview === true) return false; // Electron
    return document.documentElement.classList.contains("on-web");
  }

  // ── Token store ──────────────────────────────────────────────────────

  const auth = {
    get token() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } },
    set token(v) {
      try {
        if (v) localStorage.setItem(TOKEN_KEY, v);
        else localStorage.removeItem(TOKEN_KEY);
      } catch { /* ignore */ }
    },
    signOut() { this.token = ""; window.location.reload(); },
  };
  window.tinkerAuth = auth;

  // Drop any leftover JWT-shaped value (three base64url segments
  // separated by ".") that pre-dates the switch to Stytch session
  // tokens. The server only accepts the long-lived `session_token`
  // shape now, so a stale JWT would 401 the first Claude call and
  // surface the gate mid-session — better to clear it here on load.
  function looksLikeLegacyJwt(token) {
    return typeof token === "string" && token.split(".").length === 3;
  }

  if (!isWebPlatform()) return;
  if (auth.token && looksLikeLegacyJwt(auth.token)) auth.token = "";

  // MCP approve and MCP access send a signed-out browser here, then
  // need to land back on the same /mcp/ page after the phone code.
  const MCP_RETURN_KEY = "tinker_mcp_return";

  function takeMcpReturn() {
    let value = "";
    try { value = sessionStorage.getItem(MCP_RETURN_KEY) || ""; } catch { return ""; }
    try { sessionStorage.removeItem(MCP_RETURN_KEY); } catch { /* ignore */ }
    if (!value.startsWith("/mcp/") || value.startsWith("//") || value.includes("\\")) return "";
    if (value.includes("\n") || value.includes("\r")) return "";
    const path = value.split("?")[0];
    if (path !== "/mcp/authorize" && path !== "/mcp/access") return "";
    return value;
  }

  function resumeMcpReturn() {
    if (!auth.token) return false;
    const next = takeMcpReturn();
    if (!next) return false;
    window.location.assign(next);
    return true;
  }

  if (resumeMcpReturn()) return;

  // ── DOM refs ─────────────────────────────────────────────────────────

  const gate = document.getElementById("auth-gate");
  if (!gate) return;
  const phoneForm = document.getElementById("auth-phone-form");
  const pinForm = document.getElementById("auth-pin-form");
  const phoneInput = document.getElementById("auth-phone-input");
  const pinInput = document.getElementById("auth-pin-input");
  const backBtn = document.getElementById("auth-back");
  const statusEl = document.getElementById("auth-status");
  const titleEl = gate.querySelector("[data-step-title]");
  const ledeEl = gate.querySelector("[data-step-lede]");

  function showGate() {
    gate.hidden = false;
    document.documentElement.classList.add("auth-gating");
    setTimeout(() => phoneInput.focus(), 0);
  }

  // Expose for mid-session reauth (platform-mobile.js calls this when a
  // proxied request 401s, instead of reloading the page).
  auth.showGate = showGate;

  if (!auth.token) {
    showGate();
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  function setStatus(text, kind) {
    statusEl.textContent = text || "";
    statusEl.dataset.kind = kind || "";
  }

  function formatPhone(raw) {
    const d = raw.replace(/\D/g, "").slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }

  function showStep(step) {
    if (step === "pin") {
      phoneForm.hidden = true;
      pinForm.hidden = false;
      backBtn.hidden = false;
      titleEl.textContent = "Enter your code";
      ledeEl.innerHTML = `Sent to <strong>${formatPhone(phoneInput.value)}</strong>. The code expires in 10 minutes.`;
      setTimeout(() => pinInput.focus(), 0);
    } else {
      pinForm.hidden = true;
      phoneForm.hidden = false;
      backBtn.hidden = true;
      titleEl.textContent = "Sign in to tinker";
      ledeEl.textContent = "Enter your phone — we'll text you a six-digit code.";
      setTimeout(() => phoneInput.focus(), 0);
    }
  }

  async function postJson(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) {
      const msg = (data && data.error) || `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  // ── Event wiring ─────────────────────────────────────────────────────

  phoneInput.addEventListener("input", (e) => {
    e.target.value = formatPhone(e.target.value);
  });

  phoneForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const digits = phoneInput.value.replace(/\D/g, "");
    if (digits.length !== 10) {
      setStatus("Please enter a 10-digit US phone number.", "error");
      return;
    }
    setStatus("Sending code…", "info");
    try {
      const data = await postJson("/api/auth/phone/request", { phone: digits });
      try {
        localStorage.setItem(PHONE_KEY, digits);
        if (data.phone_id) localStorage.setItem(PHONE_ID_KEY, data.phone_id);
      } catch { /* ignore */ }
      setStatus("Code sent.", "info");
      showStep("pin");
    } catch (err) {
      setStatus(err.message, "error");
    }
  });

  pinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const phoneId = (() => {
      try { return localStorage.getItem(PHONE_ID_KEY) || ""; }
      catch { return ""; }
    })();
    if (!phoneId) {
      setStatus("Session expired — request a new code.", "error");
      showStep("phone");
      return;
    }
    const pin = pinInput.value.replace(/\D/g, "");
    if (pin.length !== 6) {
      setStatus("Enter the 6-digit code you received.", "error");
      return;
    }
    setStatus("Verifying…", "info");
    try {
      const data = await postJson("/api/auth/phone/verify", { phone_id: phoneId, pin });
      auth.token = data.token;
      try { localStorage.removeItem(PHONE_ID_KEY); } catch { /* ignore */ }
      // Let pwa-session.js fold the fresh JWT into the manifest's
      // start_url so an immediate "Add to Home Screen" carries the
      // session into the standalone PWA.
      try { window.dispatchEvent(new CustomEvent("tinker:auth-changed")); } catch { /* ignore */ }
      if (resumeMcpReturn()) return;
      setStatus(data.isNew ? "Welcome to tinker!" : "Welcome back.", "ok");
      // Brief beat so the success message lands, then drop the gate.
      setTimeout(() => {
        document.documentElement.classList.remove("auth-gating");
        gate.hidden = true;
      }, 350);
    } catch (err) {
      setStatus(err.message, "error");
      pinInput.select();
    }
  });

  backBtn.addEventListener("click", () => {
    setStatus("", "");
    showStep("phone");
  });
})();
