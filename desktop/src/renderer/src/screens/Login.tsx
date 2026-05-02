import { useState, type FormEvent } from "react";
import { login } from "../lib/api";
import type { AuthUser } from "../types";
import { BrandMark } from "./BrandMark";

interface Props {
  onSuccess: (token: string, user: AuthUser) => void | Promise<void>;
  onSwitchToSignup: () => void;
}

export function Login({ onSuccess, onSwitchToSignup }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await login(email.trim(), password);
      await onSuccess(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <BrandMark />
      <h1 className="font-display text-3xl font-bold tracking-tight">
        Welcome back
      </h1>
      <p className="text-sm text-muted">
        Sign in to keep chatting with Claude through the shared key.
      </p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="login-email">Email</label>
          <input
            id="login-email"
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
          <label className="label" htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
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
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-sm text-muted">
        New here?{" "}
        <button
          type="button"
          onClick={onSwitchToSignup}
          className="font-semibold text-accent hover:underline"
        >
          Create an account
        </button>
      </p>
    </AuthShell>
  );
}

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col">
      {/* drag strip so users can still move the frameless window */}
      <div className="drag-region h-10 w-full" />
      <div className="flex flex-1 items-center justify-center px-6 pb-10">
        <div className="w-full max-w-md rounded-3xl border border-border bg-white px-8 py-10 shadow-soft">
          {children}
        </div>
      </div>
    </div>
  );
}
