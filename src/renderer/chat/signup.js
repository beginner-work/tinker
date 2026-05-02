import { signup, ApiError } from "./api.js";

export function bindSignupForm({ onSuccess }) {
  const form = document.getElementById("auth-form");
  const submit = document.getElementById("auth-submit");
  const errorEl = document.getElementById("auth-error");
  const passwordInput = document.getElementById("auth-password");
  const hint = document.getElementById("auth-password-hint");

  submit.textContent = "Create account";
  passwordInput.setAttribute("autocomplete", "new-password");
  passwordInput.setAttribute("minlength", "8");
  hint.hidden = false;

  async function handle(e) {
    e.preventDefault();
    errorEl.hidden = true;

    const email = document.getElementById("auth-email").value.trim();
    const password = passwordInput.value;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorEl.textContent = "Valid email required";
      errorEl.hidden = false;
      return;
    }
    if (password.length < 8) {
      errorEl.textContent = "Password must be at least 8 characters";
      errorEl.hidden = false;
      return;
    }

    submit.disabled = true;
    submit.textContent = "Creating…";
    try {
      const { token, user } = await signup(email, password);
      onSuccess({ token, user });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Network error — is the backend running?";
      errorEl.textContent = msg;
      errorEl.hidden = false;
      submit.disabled = false;
      submit.textContent = "Create account";
    }
  }

  form.addEventListener("submit", handle);
  return () => form.removeEventListener("submit", handle);
}
