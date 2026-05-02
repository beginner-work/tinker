import { useState, type FormEvent } from "react";
import { signup } from "../lib/api";
import type { AuthUser } from "../types";
import { AuthShell } from "./Login";
import { BrandMark } from "./BrandMark";

interface Props {
  onSuccess: (token: string, user: AuthUser) => void | Promise<void>;
  onSwitchToLogin: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Signup({ onSuccess, onSwitchToLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Mirror the server's validation locally so we can avoid the round trip.
    // Server is the source of truth; these are just nicer messages.
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    try {
      const result = await signup(trimmed, password);
      await onSuccess(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <BrandMark />
      <h1 className="font-display text-3xl font-bold tracking-tight">
        Create your account
      </h1>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="signup-email">Email</label>
          <input
            id="signup-email"
            type="email"
            autoComplete="email"
            required
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </div>
        <div>
          <label className="label" htmlFor="signup-password">
            Password <span className="text-muted">(8+ characters)</span>
          </label>
          <input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className="field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </div>

        {error && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary mt-2" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-sm text-muted">
        Already have an account?{" "}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="font-semibold text-accent hover:underline"
        >
          Sign in
        </button>
      </p>
    </AuthShell>
  );
}
