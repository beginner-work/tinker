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
  const finePrintEl = gate.querySelector("[data-step-fineprint]");
  const githubBlock = document.getElementById("auth-github-block");
  const githubBtn = document.getElementById("auth-github-btn");
  const reposForm = document.getElementById("auth-repos-form");
  const reposFilter = document.getElementById("auth-repos-filter");
  const reposList = document.getElementById("auth-repos-list");
  const reposSkip = document.getElementById("auth-repos-skip");

  function showGate() {
    gate.hidden = false;
    document.documentElement.classList.add("auth-gating");
    setTimeout(() => { if (!phoneForm.hidden) phoneInput.focus(); }, 0);
  }

  // Expose for mid-session reauth (platform-mobile.js calls this when a
  // proxied request 401s, instead of reloading the page).
  auth.showGate = showGate;

  // ── GitHub OAuth return trip ─────────────────────────────────────────
  //
  // /api/auth/github/callback lands back on the app with the outcome in
  // the URL fragment (never sent to servers): #gh=<session_token> on
  // success, #gh_error=<message> on failure. Store the token, scrub the
  // address bar, then walk the developer through the repo picker.

  const oauthReturn = (() => {
    const raw = (window.location.hash || "").replace(/^#/, "");
    if (!/(^|&)(gh|gh_error)=/.test(raw)) return null;
    const params = new URLSearchParams(raw);
    try {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch { /* ignore */ }
    return {
      token: params.get("gh") || "",
      isNew: params.get("gh_new") === "1",
      error: params.get("gh_error") || "",
    };
  })();

  if (oauthReturn && oauthReturn.token) {
    auth.token = oauthReturn.token;
    try { window.dispatchEvent(new CustomEvent("tinker:auth-changed")); } catch { /* ignore */ }
    showGate();
    showStep("repos");
    setStatus(oauthReturn.isNew ? "Welcome to tinker!" : "Welcome back.", "ok");
    loadRepos();
  } else if (oauthReturn && oauthReturn.error) {
    showGate();
    setStatus(oauthReturn.error, "error");
  } else if (!auth.token) {
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
    // The GitHub button and fine print belong to the phone step only.
    githubBlock.hidden = step !== "phone";
    if (finePrintEl) finePrintEl.hidden = step !== "phone";
    reposForm.hidden = step !== "repos";
    if (step === "repos") {
      phoneForm.hidden = true;
      pinForm.hidden = true;
      backBtn.hidden = true;
      titleEl.textContent = "Choose your repositories";
      ledeEl.textContent =
        "Pick the repos tinker can access. It won't touch anything you don't select, and you can change this later.";
    } else if (step === "pin") {
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

  async function authedJson(path, method, body) {
    const res = await fetch(path, {
      method: method || "GET",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) {
      const msg = (data && data.error) || `Request failed (${res.status})`;
      throw Object.assign(new Error(msg), { status: res.status });
    }
    return data;
  }

  // Brief beat so the success message lands, then drop the gate.
  function dismissGate() {
    setTimeout(() => {
      document.documentElement.classList.remove("auth-gating");
      gate.hidden = true;
    }, 350);
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
      dismissGate();
    } catch (err) {
      setStatus(err.message, "error");
      pinInput.select();
    }
  });

  backBtn.addEventListener("click", () => {
    setStatus("", "");
    showStep("phone");
  });

  // ── GitHub sign-in + repo picker ─────────────────────────────────────

  async function startGitHubFlow() {
    setStatus("Heading to GitHub…", "info");
    try {
      const data = await getJson("/api/auth/github/start");
      window.location.assign(data.url);
    } catch (err) {
      setStatus(err.message, "error");
    }
  }

  githubBtn.addEventListener("click", startGitHubFlow);

  // Expose for signed-in surfaces (settings, repo picker) that want to
  // connect GitHub to the current account. The Bearer token below makes
  // the server mint an attach token, so the round-trip links GitHub to
  // this user instead of creating a second one.
  auth.connectGitHub = startGitHubFlow;

  // /start is a GET that returns JSON (so a missing config can degrade
  // to a friendly message instead of a broken redirect). Sends the
  // session token when we have one, to link rather than fork accounts.
  async function getJson(path) {
    const res = await fetch(
      path,
      auth.token ? { headers: { Authorization: `Bearer ${auth.token}` } } : undefined,
    );
    let data = null;
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok || !data.url) {
      throw new Error((data && data.error) || `Request failed (${res.status})`);
    }
    return data;
  }

  function renderRepos(repos, selected) {
    const chosen = new Set(selected || []);
    reposList.textContent = "";
    if (!repos.length) {
      const empty = document.createElement("p");
      empty.className = "auth-gate__repo-empty";
      empty.textContent = "No repositories found on this GitHub account.";
      reposList.appendChild(empty);
      return;
    }
    for (const repo of repos) {
      const row = document.createElement("label");
      row.className = "auth-gate__repo";
      row.dataset.name = repo.fullName.toLowerCase();

      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = repo.fullName;
      box.checked = chosen.has(repo.fullName);

      const name = document.createElement("span");
      name.className = "auth-gate__repo-name";
      name.textContent = repo.fullName;

      row.append(box, name);
      if (repo.private) {
        const chip = document.createElement("span");
        chip.className = "auth-gate__repo-chip";
        chip.textContent = "private";
        row.appendChild(chip);
      }
      reposList.appendChild(row);
    }
  }

  async function loadRepos() {
    reposList.textContent = "";
    const loading = document.createElement("p");
    loading.className = "auth-gate__repo-empty";
    loading.textContent = "Loading your repositories…";
    reposList.appendChild(loading);
    try {
      const data = await authedJson("/api/auth/github/repos");
      renderRepos(data.repos || [], data.selected || []);
    } catch (err) {
      reposList.textContent = "";
      const failed = document.createElement("p");
      failed.className = "auth-gate__repo-empty";
      if (err.status === 409) {
        // Signed in (by phone) but no GitHub linked yet — offer to
        // connect it to this same account.
        failed.textContent = "No GitHub account is connected yet.";
        const connect = document.createElement("button");
        connect.type = "button";
        connect.className = "auth-gate__link";
        connect.textContent = "Connect GitHub to this account";
        connect.addEventListener("click", startGitHubFlow);
        reposList.append(failed, connect);
        return;
      }
      failed.textContent = `Couldn't load repositories — ${err.message}`;
      reposList.appendChild(failed);
    }
  }

  reposFilter.addEventListener("input", () => {
    const q = reposFilter.value.trim().toLowerCase();
    for (const row of reposList.querySelectorAll(".auth-gate__repo")) {
      row.hidden = Boolean(q) && !row.dataset.name.includes(q);
    }
  });

  reposForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const picked = Array.from(
      reposList.querySelectorAll("input[type=checkbox]:checked"),
      (box) => box.value,
    );
    setStatus("Saving…", "info");
    try {
      await authedJson("/api/auth/github/repos", "PUT", { repos: picked });
      setStatus(
        picked.length
          ? `Connected — tinker can use ${picked.length} ${picked.length === 1 ? "repo" : "repos"}.`
          : "Connected — no repos shared yet.",
        "ok",
      );
      dismissGate();
    } catch (err) {
      setStatus(err.message, "error");
    }
  });

  reposSkip.addEventListener("click", () => {
    setStatus("You can connect repositories later.", "ok");
    dismissGate();
  });
})();
