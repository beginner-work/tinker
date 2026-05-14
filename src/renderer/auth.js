/* tinker — phone/PIN auth gate
 *
 * On the plain web build (the one served by src/web/server.js) we put a
 * sign-in screen in front of the renderer until the user has a JWT for the
 * Claude proxy. The JWT is stored under `tinker_jwt` in localStorage so the
 * platform-mobile shim can read it for search calls.
 *
 * On Electron desktop and on Capacitor mobile this file is loaded too but
 * the gate is skipped — desktop already has its own ANTHROPIC_API_KEY env
 * var, and Capacitor pulls a key from localStorage. Only the plain web
 * build (`html.on-web` and `window.tinker.platform === "web"`) shows the
 * gate.
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

  // Decode the JWT payload and treat anything malformed or past `exp` as
  // already invalid. Without this, a stale token in localStorage looks
  // signed-in to auth.js — the gate stays hidden, the user lands on the
  // welcome screen, types a location, and the first proxied Claude call
  // 401s and bounces them back to sign-in. Login must be the first
  // thing the user sees when login is needed at all.
  function isValidJwt(token) {
    if (!token || typeof token !== "string") return false;
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    let payload;
    try {
      let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      payload = JSON.parse(atob(b64));
    } catch { return false; }
    if (typeof payload.exp !== "number") return true;
    // Drop the token a beat before the server would 401 us so the gate
    // appears here, on load, rather than after a Claude call reloads us.
    return Math.floor(Date.now() / 1000) < payload.exp - 30;
  }

  if (!isWebPlatform()) return;
  if (auth.token && !isValidJwt(auth.token)) auth.token = "";

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
