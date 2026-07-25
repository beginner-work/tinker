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
  await putEssays([essay, ...essays]);
  if (removeDraftId) {
    const drafts = await getDrafts().catch(() => [] as Draft[]);
    await putDrafts(drafts.filter((d) => d.id !== removeDraftId));
  }
}

export { mergeById, putDrafts, getDrafts };
