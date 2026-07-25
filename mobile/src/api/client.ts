/* API client for the tinker Vercel deployment.
 * Mirrors src/renderer/platform-mobile.js — Bearer Stytch session token. */

import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "tinker_session_token";

const API_BASE: string =
  process.env.EXPO_PUBLIC_API_BASE ||
  (Constants.expoConfig?.extra?.apiBase as string) ||
  "https://tinker-theta.vercel.app";

let cachedToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export async function getToken(): Promise<string> {
  if (cachedToken !== null) return cachedToken;
  try {
    cachedToken = (await SecureStore.getItemAsync(TOKEN_KEY)) || "";
  } catch {
    cachedToken = "";
  }
  return cachedToken;
}

export async function setToken(token: string): Promise<void> {
  cachedToken = token;
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Keep in-memory token if keystore write fails.
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { method = "GET", body, auth = true } = opts;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (auth) {
    const token = await getToken();
    if (!token) {
      onUnauthorized?.();
      throw new ApiError("Sign in to continue.", 401);
    }
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && auth) {
    await setToken("");
    onUnauthorized?.();
    throw new ApiError("Session expired — sign in again.", 401);
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON body
  }
  if (!res.ok) {
    throw new ApiError(
      json?.error || `Request failed (${res.status})`,
      res.status,
    );
  }
  return json as T;
}

export { API_BASE };
