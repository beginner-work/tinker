#!/usr/bin/env node
/* Revoke approved_to_send drafts that are not sendable (notes-only).
 * Requires DATABASE_URL. Optionally filter with --name "Andrew Glenn".
 * Does not send anything.
 */
"use strict";
import { PrismaClient } from "@prisma/client";

const nameFilter = (() => {
  const i = process.argv.indexOf("--name");
  return i >= 0 ? String(process.argv[i + 1] || "").trim().toLowerCase() : "";
})();

function sendable(draft, lead) {
  const body = String(draft.body || "").trim();
  if (!body) return false;
  if (draft.channel === "gmail_outreach") {
    return !!(String(lead?.email || "").trim() && String(draft.subject || "").trim());
  }
  if (draft.channel === "linkedin_connection" || draft.channel === "linkedin_post") {
    return !!String(lead?.linkedInUrl || "").trim();
  }
  return false;
}

const prisma = new PrismaClient();
const drafts = await prisma.leadDraft.findMany({ where: { status: "approved_to_send" } });
const leads = await prisma.lead.findMany();
const byId = new Map(leads.map((l) => [l.id, l]));
let revoked = 0;
for (const draft of drafts) {
  const lead = (draft.leadId && byId.get(draft.leadId)) || null;
  if (nameFilter && String(lead?.personName || "").trim().toLowerCase() !== nameFilter) continue;
  if (sendable(draft, lead)) continue;
  await prisma.leadDraft.update({
    where: { id: draft.id },
    data: {
      status: "draft",
      approvedAt: null,
      approvedText: "",
      approvedPersonName: "",
      approvedCompanyName: "",
      failedReason: "",
    },
  });
  console.log("revoked", draft.id, lead?.personName || "(no lead)", draft.channel);
  revoked += 1;
}
console.log("done", { scanned: drafts.length, revoked });
await prisma.$disconnect();
