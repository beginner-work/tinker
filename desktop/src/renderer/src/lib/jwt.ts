import { jwtDecode } from "jwt-decode";

interface TokenPayload {
  claudeUserId: string;
  iat: number;
  exp: number;
}

// We only inspect exp — never trust the payload for anything that matters.
// Returns true if we have a token AND it doesn't expire within the next
// 30 seconds (small skew buffer).
export function isTokenLive(token: string | null | undefined): boolean {
  if (!token) return false;
  try {
    const { exp } = jwtDecode<TokenPayload>(token);
    if (typeof exp !== "number") return false;
    const nowSec = Math.floor(Date.now() / 1000);
    return exp - nowSec > 30;
  } catch {
    return false;
  }
}
