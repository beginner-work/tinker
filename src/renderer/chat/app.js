// Top-level entry for the chat window. Routes between Auth (login/signup)
// and Chat based on the JWT pulled from main-process safeStorage.

import { isExpired, decodeJwt } from "./jwt.js";
import { getBackendUrl } from "./api.js";
import { bindLoginForm } from "./login.js";
import { bindSignupForm } from "./signup.js";
import { mountChat } from "./chat-screen.js";

const screens = {
  auth: document.getElementById("screen-auth"),
  chat: document.getElementById("screen-chat"),
};

function show(name) {
  for (const [k, el] of Object.entries(screens)) {
    if (k === name) el.setAttribute("data-active", "");
    else el.removeAttribute("data-active");
  }
}

let token = null;
let user = null;
let detachAuth = null;

async function init() {
  // Surface the resolved backend URL on the auth card — useful for spotting
  // when the app is pointed at the wrong env (dev vs preview vs prod).
  getBackendUrl()
    .then((url) => {
      const label = document.getElementById("auth-backend");
      if (label) label.textContent = url;
    })
    .catch(() => {});

  token = await window.api.getToken().catch(() => null);
  if (token && !isExpired(token)) {
    // Pull the user id out of the JWT payload for display only — backend
    // is the source of truth for actual identity.
    const payload = decodeJwt(token) || {};
    user = { id: payload.claudeUserId, email: "" };
    enterChat();
  } else {
    if (token) await window.api.clearToken().catch(() => {});
    enterAuth("login");
  }
}

function enterAuth(mode) {
  show("auth");
  detachAuth?.();
  setActiveTab(mode);

  const onSuccess = async ({ token: t, user: u }) => {
    token = t;
    user = u;
    await window.api.setToken(t).catch(() => {});
    enterChat();
  };

  if (mode === "login") detachAuth = bindLoginForm({ onSuccess });
  else detachAuth = bindSignupForm({ onSuccess });
}

function setActiveTab(mode) {
  const loginTab = document.getElementById("tab-login");
  const signupTab = document.getElementById("tab-signup");
  loginTab.setAttribute("aria-selected", String(mode === "login"));
  signupTab.setAttribute("aria-selected", String(mode === "signup"));
  // Reset error + form on tab switch so stale state doesn't leak across modes.
  document.getElementById("auth-error").hidden = true;
  document.getElementById("auth-form").reset();
  document.getElementById("auth-submit").disabled = false;
}

document.getElementById("tab-login").addEventListener("click", () => enterAuth("login"));
document.getElementById("tab-signup").addEventListener("click", () => enterAuth("signup"));

function enterChat() {
  show("chat");
  detachAuth?.();
  detachAuth = null;
  mountChat({
    token,
    user,
    onLogout: async () => {
      await window.api.clearToken().catch(() => {});
      token = null;
      user = null;
      // Hard reload so chat-screen DOM state (conversations, listeners) is
      // fully torn down — simpler than a manual unmount path.
      location.reload();
    },
    on401: async () => {
      // Token rejected by the server (revoked, signing key rotated, etc.) —
      // wipe locally and bounce to login so the user can re-auth.
      await window.api.clearToken().catch(() => {});
      token = null;
      user = null;
      location.reload();
    },
  });
}

init();
