import { login } from "./api.js";
import { ApiError } from "./api.js";

// renderLogin mounts onto the shared #auth-form element. The Auth screen is
// shared between login and signup; switching tabs swaps which submit handler
// is wired up. See app.js for the screen lifecycle.

export function bindLoginForm({ onSuccess }) {
  const form = document.getElementById("auth-form");
  const submit = document.getElementById("auth-submit");
  const errorEl = document.getElementById("auth-error");
  const passwordInput = document.getElementById("auth-password");
  const hint = document.getElementById("auth-password-hint");

  submit.textContent = "Log in";
  passwordInput.setAttribute("autocomplete", "current-password");
  passwordInput.removeAttribute("minlength");
  hint.hidden = true;

  async function handle(e) {
    e.preventDefault();
    errorEl.hidden = true;
    submit.disabled = true;
    submit.textContent = "Signing in…";

    const email = document.getElementById("auth-email").value.trim();
    const password = passwordInput.value;
    try {
      const { token, user } = await login(email, password);
      onSuccess({ token, user });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Network error — is the backend running?";
      errorEl.textContent = msg;
      errorEl.hidden = false;
      submit.disabled = false;
      submit.textContent = "Log in";
    }
  }

  form.addEventListener("submit", handle);
  return () => form.removeEventListener("submit", handle);
}
