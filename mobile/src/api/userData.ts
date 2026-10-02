/* TinkerUserData blobs — whole-array semantics, same rows the web
 * renderer syncs (src/renderer/sync.js). A draft written here shows up
 * on web/desktop on their next hydrate, and vice versa. */

import { api } from "./client";

export type TranscriptEntry = { q: string; a: string };

export type Draft = {
  id: string;
  title: string;
  transcript: TranscriptEntry[];
  currentStep: number;
  stitched: { title: string; body: string } | null;
  pending: string | null;
  seed?: string | null;
  facing?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type Essay = {
  id: string;
  slug: string;
  author: string;
  title: string;
  body: string;
  createdAt: number;
  url: string;
  sourceDraft: string;
  kind: "essay";
  seed?: string | null;
  github?: {
    prUrl: string;
    prNumber: number;
    branch: string;
    path: string;
  } | null;
};

type Blob<T> = { data: T | null; updatedAt: number | null };

export async function getDrafts(): Promise<Draft[]> {
  const r = await api<Blob<Draft[]>>("/api/user-data/drafts");
  return Array.isArray(r.data) ? r.data : [];
}

export async function putDrafts(drafts: Draft[]): Promise<void> {
  await api("/api/user-data/drafts", { method: "PUT", body: { data: drafts } });
}

export async function getEssays(): Promise<Essay[]> {
  const r = await api<Blob<Essay[]>>("/api/user-data/essays");
  return Array.isArray(r.data) ? r.data : [];
}

export async function putEssays(essays: Essay[]): Promise<void> {
  await api("/api/user-data/essays", { method: "PUT", body: { data: essays } });
}

/* Same id/merge conventions as the web renderer (renderer.js uid() and
 * sync.js mergeById) so rows from either client interleave cleanly. */
export const uid = () => "d_" + Math.random().toString(36).slice(2, 10);
export const essayId = () => "e_" + Math.random().toString(36).slice(2, 10);

export function mergeById<T extends { id: string; updatedAt?: number; createdAt?: number }>(
  local: T[],
  server: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const d of server) if (d && d.id) byId.set(d.id, d);
  for (const d of local) {
    if (!d || !d.id) continue;
    const sv = byId.get(d.id);
    if (!sv) {
      byId.set(d.id, d);
      continue;
    }
    const lu = Number(d.updatedAt) || Number(d.createdAt) || 0;
    const su = Number(sv.updatedAt) || Number(sv.createdAt) || 0;
    if (lu > su) byId.set(d.id, d);
  }
  return Array.from(byId.values()).sort(
    (a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0),
  );
}
