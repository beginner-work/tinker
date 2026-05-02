// Minimal JWT decode for the renderer. The JWT is *opaque* to the client —
// we only ever read `exp` to know whether to skip the login screen on launch.
// Never trust the contents for authorization decisions; the backend re-verifies.

export function decodeJwt(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function isExpired(token) {
  const p = decodeJwt(token);
  if (!p || typeof p.exp !== "number") return true;
  // exp is seconds-since-epoch (RFC 7519 §4.1.4); compare against ms clock.
  return p.exp * 1000 <= Date.now();
}
