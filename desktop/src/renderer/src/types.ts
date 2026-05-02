export type Role = "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthResult {
  token: string;
  user: AuthUser;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
}

// Pre-call backend errors are surfaced as one of these.
export type ChatErrorKind =
  | "unauthorized" // 401 — token bad or missing → route to Login
  | "rate_limit" //   429 — daily token cap, includes retry_at
  | "misconfigured" //   503 — server has no ANTHROPIC_API_KEY_WEB
  | "bad_request" //  400 — messages array shape wrong
  | "stream" //       mid-stream upstream failure
  | "network" //      transport / parse failure
  | "unknown";

export interface ChatError {
  kind: ChatErrorKind;
  message: string;
  retryAt?: string; // ISO 8601 from the 429 body
}
