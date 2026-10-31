import { API_BASE_URL, PLATFORM } from "./config";

export type SourceHit = {
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  why?: string;
  author?: string;
  authorSource?: string;
  authorUnknown?: boolean;
  siteName?: string;
};

export type SearchPickResponse = {
  query: string;
  chosen: SourceHit;
  alternatives: SourceHit[];
  results?: SourceHit[];
  latencyMs?: number;
};

export type ExtractResponse = {
  sourceUrl: string;
  title: string;
  author: string;
  authorSource?: string;
  authorUnknown?: boolean;
  siteName?: string;
  companyHost: string;
  text: string;
  wordCount: number;
  attribution: string;
  verbatim: true;
};

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Tinker-Caller": "ios",
    },
    body: JSON.stringify({ ...body, platform: PLATFORM }),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw Object.assign(new Error(data.error || `Request failed (${res.status})`), {
      status: res.status,
    });
  }
  return data;
}

export function searchLearningGoal(
  query: string,
  meta: { anonymousId: string; owner?: "1" },
): Promise<SearchPickResponse> {
  return postJson<SearchPickResponse>("/api/browser-search", {
    query,
    anonymousId: meta.anonymousId,
    ...(meta.owner ? { owner: meta.owner } : {}),
  });
}

export function extractVerbatim(url: string): Promise<ExtractResponse> {
  return postJson<ExtractResponse>("/api/reading?action=extract", { url });
}
