/* Local draft helpers when offline / before first sync. */

import {
  Draft,
  Essay,
  getDrafts,
  getEssays,
  mergeById,
  putDrafts,
  putEssays,
  uid,
} from "../api/userData";
import { createEssayPullRequest } from "./github";

export async function createDraft(seed?: string | null): Promise<Draft> {
  const now = Date.now();
  const draft: Draft = {
    id: uid(),
    title: "Untitled",
    transcript: [],
    currentStep: 0,
    stitched: null,
    pending: null,
    seed: seed ?? null,
    facing: null,
    createdAt: now,
    updatedAt: now,
  };
  try {
    const server = await getDrafts();
    await putDrafts(mergeById([draft], server));
  } catch {
    // Offline — caller still holds the draft in memory / route params.
  }
  return draft;
}

export async function listDrafts(): Promise<Draft[]> {
  try {
    return await getDrafts();
  } catch {
    return [];
  }
}

export async function listEssays(): Promise<Essay[]> {
  try {
    return await getEssays();
  } catch {
    return [];
  }
}

export async function saveEssay(essay: Essay, removeDraftId?: string) {
  const essays = await getEssays().catch(() => [] as Essay[]);
  const without = essays.filter((e) => e.id !== essay.id);
  await putEssays([essay, ...without]);
  if (removeDraftId) {
    const drafts = await getDrafts().catch(() => [] as Draft[]);
    await putDrafts(drafts.filter((d) => d.id !== removeDraftId));
  }
}

/**
 * Persist the essay, then open a GitHub PR in the connected repo.
 * PR failure still keeps the essay — the founder can retry from assessing.
 */
export async function publishEssayWithPullRequest(
  essay: Essay,
  removeDraftId?: string,
): Promise<{ essay: Essay; prError: string | null }> {
  let next: Essay = { ...essay, github: essay.github ?? null };
  await saveEssay(next, removeDraftId);
  try {
    const pr = await createEssayPullRequest(next);
    next = { ...next, github: pr };
    await saveEssay(next);
    return { essay: next, prError: null };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Essay saved, but the GitHub PR failed.";
    return { essay: next, prError: message };
  }
}

/** Retry opening a PR for an already-published essay. */
export async function retryEssayPullRequest(
  essay: Essay,
): Promise<{ essay: Essay; prError: string | null }> {
  try {
    const pr = await createEssayPullRequest(essay);
    const next: Essay = { ...essay, github: pr };
    await saveEssay(next);
    return { essay: next, prError: null };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Could not open a GitHub pull request.";
    return { essay, prError: message };
  }
}

export { mergeById, putDrafts, getDrafts };
