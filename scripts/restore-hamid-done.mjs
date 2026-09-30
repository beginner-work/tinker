#!/usr/bin/env node
/**
 * Restore Hamid Dadkhah's Keep crafting completed marker (### __done__).
 *
 * Prefers DATABASE_URL (direct markLeadDone). Falls back to documenting that
 * MCP mark_lead_done must be called after deploy when DATABASE_URL is unset.
 *
 * Does NOT regenerate proposedSubject — restore subjects from LeadEvent history
 * when available (previousSubject / draft subject), never from Claude.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const HAMID_ID = "cmun6g1tr000711be2llfsrjo";
const FARIA_ID = "cmun6gqfw0009rekct3yx4bfj";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(JSON.stringify({
      ok: false,
      error: "DATABASE_URL unset",
      next: "After deploy, call MCP mark_lead_done with personId=" + HAMID_ID,
      note: "Faria still has ### __done__; original proposedSubject needs LeadEvent/draft history via DATABASE_URL",
    }, null, 2));
    process.exit(2);
  }

  const store = require(path.join(__dirname, "..", "api/_lib/leads-store.js"));
  const prisma = require(path.join(__dirname, "..", "api/_lib/db.js"));

  const hamid = await prisma.lead.findUnique({ where: { id: HAMID_ID } });
  if (!hamid) {
    console.error(JSON.stringify({ ok: false, error: "Hamid lead not found", id: HAMID_ID }, null, 2));
    process.exit(1);
  }

  const before = {
    id: hamid.id,
    updatedAt: hamid.updatedAt,
    hasDone: store.notesHaveDoneMarker(hamid.notes),
    notesLen: String(hamid.notes || "").length,
  };

  const saved = await store.markLeadDone({
    id: HAMID_ID,
    userId: hamid.userId,
    emailHint: "",
    actor: { kind: "bot", label: "script:restore-hamid-done" },
  });

  // Subject history: prefer LeadEvent draft_edited previousSubject, else current draft.
  const events = await prisma.leadEvent.findMany({
    where: { leadId: { in: [HAMID_ID, FARIA_ID] }, action: "draft_edited" },
    orderBy: { at: "asc" },
  });
  const subjects = {};
  for (const ev of events) {
    const d = ev.detail || {};
    if (!d.previousSubject && !d.nextSubject) continue;
    if (!subjects[ev.leadId]) subjects[ev.leadId] = [];
    subjects[ev.leadId].push({
      at: ev.at,
      previousSubject: d.previousSubject || "",
      nextSubject: d.nextSubject || "",
      actor: ev.actor,
    });
  }

  const drafts = await prisma.leadDraft.findMany({
    where: {
      leadId: { in: [HAMID_ID, FARIA_ID] },
      channel: "gmail_outreach",
    },
    orderBy: { updatedAt: "desc" },
  });

  console.log(JSON.stringify({
    ok: true,
    hamid: {
      before,
      after: {
        id: saved.id,
        updatedAt: saved.updatedAt,
        hasDone: store.notesHaveDoneMarker(saved.notes),
        notesLen: String(saved.notes || "").length,
      },
    },
    subjectHistory: subjects,
    currentDraftSubjects: drafts.map((d) => ({
      id: d.id,
      leadId: d.leadId,
      subject: d.subject,
      status: d.status,
      updatedAt: d.updatedAt,
    })),
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err && err.message || err) }, null, 2));
  process.exit(1);
});
