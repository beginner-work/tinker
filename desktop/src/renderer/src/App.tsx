import { useCallback, useEffect, useState } from "react";
import { Chat } from "./screens/Chat";
import { Login } from "./screens/Login";
import { Signup } from "./screens/Signup";
import { isTokenLive } from "./lib/jwt";
import { storage } from "./lib/storage";
import type { AuthUser } from "./types";

type Route = "loading" | "login" | "signup" | "chat";

export default function App() {
  const [route, setRoute] = useState<Route>("loading");
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  // On launch, restore the token from safeStorage. If still valid, jump
  // straight to the Chat screen — otherwise show Login.
  useEffect(() => {
    let cancelled = false;
    storage.getToken().then(async (existing) => {
      if (cancelled) return;
      if (isTokenLive(existing)) {
        setToken(existing);
        setRoute("chat");
      } else {
        if (existing) await storage.clearToken();
        setRoute("login");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAuthSuccess = useCallback(
    async (newToken: string, authedUser: AuthUser) => {
      await storage.setToken(newToken);
      setToken(newToken);
      setUser(authedUser);
      setRoute("chat");
    },
    []
  );

  const handleLogout = useCallback(async () => {
    await storage.clearToken();
    setToken(null);
    setUser(null);
    setRoute("login");
  }, []);

  if (route === "loading") {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="h-2 w-2 animate-pulse rounded-full bg-accent" />
      </div>
    );
  }

  if (route === "login") {
    return (
      <Login
        onSuccess={handleAuthSuccess}
        onSwitchToSignup={() => setRoute("signup")}
      />
    );
  }

  if (route === "signup") {
    return (
      <Signup
        onSuccess={handleAuthSuccess}
        onSwitchToLogin={() => setRoute("login")}
      />
    );
  }

  return <Chat token={token!} user={user} onLogout={handleLogout} />;
}
