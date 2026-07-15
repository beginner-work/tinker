import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getToken, setToken, setUnauthorizedHandler } from "../api/client";
import { requestPin, verifyPin } from "../api/auth";

type AuthState = {
  /** null while the stored token is still loading. */
  signedIn: boolean | null;
  requestCode: (phone: string) => Promise<{ phoneId: string }>;
  verifyCode: (phoneId: string, pin: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    getToken().then((t) => mounted && setSignedIn(!!t));
    setUnauthorizedHandler(() => setSignedIn(false));
    return () => {
      mounted = false;
      setUnauthorizedHandler(null);
    };
  }, []);

  const requestCode = useCallback(async (phone: string) => {
    const { phoneId } = await requestPin(phone);
    return { phoneId };
  }, []);

  const verifyCode = useCallback(async (phoneId: string, pin: string) => {
    const { token } = await verifyPin(phoneId, pin);
    await setToken(token);
    setSignedIn(true);
  }, []);

  const signOut = useCallback(async () => {
    await setToken("");
    setSignedIn(false);
  }, []);

  const value = useMemo(
    () => ({ signedIn, requestCode, verifyCode, signOut }),
    [signedIn, requestCode, verifyCode, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
