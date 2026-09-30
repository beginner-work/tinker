/* POST /api/mcp
 *
 * Streamable HTTP MCP (stateless JSON responses) on the tinker deploy.
 * Authorization: Bearer <stytch session_token | session_jwt | mcp_ credential>
 *   Session bearers use authenticateSession, the same check as
 *   POST /api/claude/converse. A bearer that starts with mcp_ is checked
 *   against the hashed McpApiKey row and is never sent to Stytch.
 *   Revoked credentials fail on the next request.
 *   A missing or rejected bearer is 401 with resource_metadata so an
 *   MCP client can send the user to /mcp/authorize.
 *
 * Tools are fixed-prompt follow-ups (ask_followups), LinkedIn drafts
 * (draft_linkedin_post), a read-only look at this user's autonomy
 * settings (get_autonomy_settings), the career record
 * (get_career_record, check_text), site content (list_content,
 * read_content, create_content_draft), story parts (list_story_parts,
 * get_story_part), outreach schedule (get_outreach_schedule,
 * set_busy_times), post_to_self_thread (assistant posts into the
 * owner's You inbox thread), and reading workbook tools
 * (create_reading_thread, get_reading_thread, list_reading_threads,
 * advance_reading_section). There is no raw converse proxy and no
 * write tool for autonomy settings, the career record, or story parts.
 * Content tools can draft. They cannot publish. Story-part tools are
 * read-only: paste the user's approved wording into Formation drafts;
 * Tinker does not draft or send outreach. GET/DELETE return 405: this
 * server does not keep an SSE session. draft_linkedin_post shares
 * api/_lib/linkedin-draft.js with POST /api/claude/converse mode
 * "linkedin". It does not post.
 *
 * Session auth uses STYTCH_PROJECT_ID and STYTCH_SECRET. Tool calls use
 * ANTHROPIC_API_KEY. Credentials use the existing DATABASE_URL.
 * Approve and revoke live on /mcp/authorize and /mcp/access.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { isMcpApiKey, authenticateMcpKey, userIdFromSession } = require("./_lib/mcp-keys.js");
const { wwwAuthenticate } = require("./_lib/mcp-origin.js");
const { withResponseLogging } = require("./_lib/log.js");
const { askFollowups } = require("./_lib/followups.js");
const { draftLinkedInPost } = require("./_lib/linkedin-draft.js");
const { toolSettings } = require("./_lib/autonomy.js");
const scheduleStore = require("./_lib/outreach-schedule-store.js");
const leadsStore = require("./_lib/leads-store.js");
const companiesStore = require("./_lib/leads-companies-store.js");
const { UNAVAILABLE, readAll } = require("./_lib/autonomy-redis.js");
const { UNAVAILABLE: CAREER_UNAVAILABLE, readForTool, shapeForTool } = require("./_lib/career.js");
const { checkText } = require("./_lib/career-check.js");
const contentStore = require("./_lib/content-store.js");
const storyParts = require("./_lib/story-parts-store.js");
const selfThread = require("./_lib/self-thread-store.js");
const readingThreads = require("./_lib/reading-thread-store.js");
const prisma = require("./_lib/db.js");
const pkg = require("../package.json");
const MCP_BOT_ACTOR = { kind: "bot", label: "bot:mcp" };
const OWNER_PROFILE_UNAVAILABLE = "Owner profile is unavailable right now.";

const SUPPORTED_PROTOCOLS = ["2025-03-26", "2025-06-18"];
const DEFAULT_PROTOCOL = "2025-03-26";

const INSTRUCTIONS = [
  "tinker tools for founder writing and Tyler's LinkedIn drafts. The writing UI is separate and unchanged.",
  "Call get_outreach_schedule to read the Mon–Fri outreach plan (sessions, touches, busyEvents). Call set_busy_times to store busy blocks from the owner's assistant. Call ask_followups with a transcript of {q, a} turns to run the founder interview",
  "(one next question, or a stitch when the draft is ready), or with a draft string",
  "for freeform follow-up questions. Optional priorTurns avoids repeats.",
  "Pass keepCrafting true when the owner pressed Keep crafting: the server must return a next_question (never done or stitch); empty model replies retry then fall back to a stage question.",
  "Call draft_linkedin_post with notes (a topic or bullets) to draft a LinkedIn post or direct message in Tyler's voice.",
  "Pass kind \"dm\" for a direct message, or start the notes with \"DM:\". Pass currentDraft and an optional instruction to revise.",
  "This drafts copy only. It does not post to LinkedIn.",
  "Call get_autonomy_settings with no arguments to read this user's autonomy settings.",
  "It returns each setting's key, label, description, on (true or false), and updated_at.",
  "It does not change a setting. If it says settings are unavailable, treat every setting as off.",
  "Call get_career_record with no arguments to read this user's career record.",
  "Verified facts and answer rules include ids. Unverified facts are marked and are not facts. Do not use them.",
  "Rejected facts are omitted. If the record is unavailable, do not invent an empty record.",
  "Call check_text with text, and optional company and field_label, to check a draft.",
  "Each claim is pass, mismatch, unsupported, or needs_claire. ready is true only when every claim passes. An empty draft, or a draft with no claims, is not ready.",
  "These career tools do not write. There is no tool that verifies or edits a fact.",
  "Call list_content to list this user's content items. Optional site, type, and status filter the list.",
  "Call read_content with an id to read one item. Someone else's id returns an error and no item.",
  "Call create_content_draft to save a draft. The same draftKey returns the original draft and does not change it.",
  "Content tools never publish. status published is rejected and nothing is saved. The owner publishes in Tinker.",
  "Call list_story_parts to list ready story parts by stage, concepts, or teamOrRole.",
  "Stages are fixed: hook, proof_point, connecting_story, fit, ask.",
  "concepts are kebab-case tags for fundamental engineering concepts the user stands behind.",
  "Call get_story_part with an id to read one part. Someone else's id returns an error and no part.",
  "Story parts are the user's approved wording for pasting into Formation drafts. Tinker does not draft or send outreach.",
  "Story-part tools are read-only. They do not mark parts ready, edit parts, or change stages.",
  "Call upsert_target_company to create or update a target company (name, priority, tier, notes, research). Omitted fields are left unchanged.",
  "Call upsert_lead_person to create or update a person under a company (role type, next step, due date, sequence position, optional person notes).",
  "Omitted person fields are left unchanged. Email/nextStep updates never wipe notepad notes.",
  "When notes are passed, the store merges and preserves a trailing ### __done__ completed marker.",
  "Person upserts never write company notes/research - use upsert_target_company for those.",
  "Call mark_lead_done with personId (or personName+companyName) to append ### __done__ without replacing Q&A.",
  "Call list_target_companies to read companies with their people. Bots write lead structure only; they never send.",
  "Prefer those lead tools over dumping GTM prose into the You thread.",
  "Call save_outreach_draft to put a composed email or LinkedIn message into a person's chat for the owner to review.",
  "Pass personName and companyName (or personId), channel email|linkedin, to, subject (email only), and body.",
  "It stores or replaces the composed draft on that person. It never approves. The owner approves with This is everything on the review card.",
  "Owner notepad notes stay separate from the composed draft.",
  "Call list_approved_outreach to read drafts the owner handed off with This is everything (approved_to_send, unsent).",
  "Only sendable approvals appear (email: recipient + subject + body; LinkedIn: profile URL + body).",
  "A bot may send only the exact approvedText, once per approval. After sending, call mark_outreach_sent; on failure call mark_outreach_failed.",
  "mark_outreach_sent also records a send the owner already made outside Tinker for a draft that was never approved:",
  "pass id, or personId / personName+companyName, plus channel and sentAt. One send per draft. Sent drafts cannot be approved again.",
  "Tinker itself never sends email or LinkedIn messages.",
  "Call post_to_self_thread with title and short markdown body only for brief personal assistant notes in the You thread.",
  "Never post deploy checks, production status, allowlist/gate notes, or other ops chatter there - that thread is the owner's own story.",
  "The owner sees it as an incoming assistant bubble. It does not send email or LinkedIn messages.",
  "Call create_reading_thread to start a generic reading workbook (any book): title, optional author, ordered sections (string titles).",
  "It generates one pre-read question for the first section via KEEP_CRAFTING_MODEL and shows the thread in the inbox like a lead.",
  "Call list_reading_threads or get_reading_thread to read threads. Call advance_reading_section when the owner finished a section to mark it done and generate the next pre-read question.",
  "Reading notepad notes use the same merge-safe ### __done__ contract as lead notes. Do not seed books in app code; create them with create_reading_thread after deploy.",
  "Call update_owner_profile to set optional title and/or linkedInUrl on this connector user's own profile.",
  "Omitted fields are left unchanged. Pass an empty string to clear a field. A user id in args is ignored.",
  "This server does not accept a custom system prompt.",
  "Add this server by its URL. The client sends you to tinker to approve access.",
  "After you approve, the client stores a credential that starts with mcp_. It works until you revoke it from MCP access.",
  "A Stytch session still works for the writing app. A 401 means the credential is missing or revoked.",
].join(" ");

const ASK_FOLLOWUPS_TOOL = {
  name: "ask_followups",
  title: "Ask follow-up questions",
  description: [
    "Return follow-up questions for founder writing.",
    "Pass transcript (array of {q, a}) to run tinker's interview contract:",
    "the result is JSON with next_question, optional stitched essay fields, and done.",
    "Pass draft (string) instead for 3–5 freeform questions about what the writer is learning.",
    "Optional priorTurns (strings or {q, a}) are questions already asked.",
    "Optional seed, facing, lastPurchased, voice, and transactions",
    "shape the interview the same way the writing UI does.",
    "Pass keepCrafting true when the owner wants another question (Keep crafting):",
    "the server never returns done or a stitch for that call; empty replies retry then fall back.",
    "Do not send a system prompt; the server owns it.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      draft: {
        type: "string",
        description: "Freeform writing. Used when transcript is omitted. Returns { questions }.",
      },
      transcript: {
        type: "array",
        description: "Founder interview turns so far. An empty array starts the interview.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            q: { type: "string" },
            a: { type: "string" },
          },
          required: ["q", "a"],
        },
      },
      priorTurns: {
        type: "array",
        description: "Questions already asked, as strings or { q, a } objects.",
        items: {
          anyOf: [
            { type: "string" },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                q: { type: "string" },
                a: { type: "string" },
              },
              required: ["q", "a"],
            },
          ],
        },
      },
      seed: { type: "string", description: "Where the founder is right now." },
      facing: { type: "string", description: "What the founder is facing." },
      lastPurchased: { type: "string", description: "What the founder last purchased." },
      voice: {
        type: "string",
        description: "Optional writing-voice block. Shapes how questions are phrased.",
      },
      transactions: {
        type: "array",
        description: "Recent transactions, as preformatted strings or { date, merchant, amount, category }.",
        items: {},
      },
      forceStitch: {
        type: "boolean",
        description: "Interview mode only. Skip further questions and stitch the essay.",
      },
      keepCrafting: {
        type: "boolean",
        description:
          "Interview mode only. Owner pressed Keep crafting: always return a next_question; never done or stitch.",
      },
    },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
};

const DRAFT_LINKEDIN_TOOL = {
  name: "draft_linkedin_post",
  title: "Draft a LinkedIn post or DM",
  description: [
    "Draft or revise a LinkedIn post or direct message in Tyler's voice for Elevating Developer Fintech.",
    "Pass notes: a topic or bullet points. The server owns the voice and niche prompt (short plain sentences, no em dashes).",
    "Pass kind \"dm\" for a direct message. Omit kind, or pass \"post\", for a feed post. Notes that start with \"DM:\" also draft a message.",
    "Pass currentDraft to revise an existing draft, and an optional instruction for what to change.",
    "Returns the copy only. Does not post, schedule, or publish to LinkedIn. Stanley posts.",
    "Do not send a system prompt.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      notes: {
        type: "string",
        description: "Topic or bullet notes the post or DM should be built from.",
      },
      kind: {
        type: "string",
        enum: ["post", "dm"],
        description: "post (default) or dm. A direct message uses the same voice and does not read like a feed post.",
      },
      currentDraft: {
        type: "string",
        description: "Existing draft to revise. Omit to write a new post or DM from the notes.",
      },
      instruction: {
        type: "string",
        description: "Optional change request: length, emphasis, post vs DM, or what to cut. Cannot ask the tool to publish.",
      },
    },
    required: ["notes"],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
};

const GET_AUTONOMY_SETTINGS_TOOL = {
  name: "get_autonomy_settings",
  title: "Read autonomy settings",
  description: [
    "Return the on or off state of this connector user's 14 autonomy settings.",
    "Takes no input. The user is the person who approved this connector, not a user id in the arguments.",
    "Each setting includes key, label, description, on, and updated_at (when it last changed, or null).",
    "Three sending settings also include send_note.",
    "on true means a bot may do that item on its own. A setting with nothing stored is off.",
    "If the tool returns an error that settings are unavailable, treat every setting as off.",
    "This does not change any setting.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
};

const GET_CAREER_RECORD_TOOL = {
  name: "get_career_record",
  title: "Read the career record",
  description: [
    "Return this connector user's career record.",
    "Takes no input. The user is the person who approved this connector. A user id in the arguments is ignored.",
    "verified_facts and rules include ids and may be used as facts.",
    "unverified_facts are proposed only. They are not facts. Do not use them in applications or outreach.",
    "Rejected facts are omitted.",
    "If the tool returns an error that the career record is unavailable, do not treat that as an empty record.",
    "This does not verify, edit, or reject anything.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
};

const CHECK_TEXT_TOOL = {
  name: "check_text",
  title: "Check a draft against the career record",
  description: [
    "Check a draft application answer or outreach note against this connector user's career record.",
    "Pass text. Optional company and field_label add form context.",
    "Returns every factual claim with verdict pass, mismatch, unsupported, or needs_claire.",
    "pass and mismatch include the matching fact or rule id. mismatch includes the correct value.",
    "ready is true only when every claim passes. An empty draft, or a draft with no claims, is not ready.",
    "A title passes only when the employer on that same fact matches. Baseline and mechanism numbers are compared to the verified amount, percentage, and baseline.",
    "Visa, work authorization, EEO, demographic answers, and a field with no rule return needs_claire.",
    "This does not write to the record.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      text: {
        type: "string",
        description: "Draft application answer or outreach note to check.",
      },
      company: {
        type: "string",
        description: "Optional company the draft is for.",
      },
      field_label: {
        type: "string",
        description: "Optional form field label, such as Current location or Work authorization.",
      },
    },
    required: ["text"],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },
};

const LIST_CONTENT_TOOL = {
  name: "list_content",
  title: "List content items",
  description: [
    "List this connector user's site content items.",
    "Optional site, type (page_section, product, event, post, link), and status (draft or published) filter the list.",
    "The user is the person who approved this connector. A user id in the arguments is ignored.",
    "Someone else's items are not included.",
    "This does not publish, edit, or create.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      site: {
        type: "string",
        description: "Hostname of the site, such as dreamingwithmarisol.com.",
      },
      type: {
        type: "string",
        enum: ["page_section", "product", "event", "post", "link"],
        description: "Content type to keep.",
      },
      status: {
        type: "string",
        enum: ["draft", "published"],
        description: "draft or published. Omit to list both.",
      },
    },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
};

const READ_CONTENT_TOOL = {
  name: "read_content",
  title: "Read one content item",
  description: [
    "Read one content item that belongs to this connector user.",
    "Pass id. A user id in the arguments is ignored.",
    "Someone else's id returns an error and no item.",
    "This does not publish or edit.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      id: {
        type: "string",
        description: "Content item id from list_content or create_content_draft.",
      },
    },
    required: ["id"],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
};

const CREATE_CONTENT_DRAFT_TOOL = {
  name: "create_content_draft",
  title: "Create a content draft",
  description: [
    "Save a draft content item for this connector user.",
    "Pass site, type, slug, and title. Optional body, fields, noteId, and draftKey.",
    "type is page_section, product, event, post, or link.",
    "noteId is the note this item came from.",
    "The same draftKey returns the original draft and does not change it.",
    "The same site and slug for this user also returns the original item.",
    "status published is rejected and nothing is saved. This tool cannot publish.",
    "A user id in the arguments is ignored.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      site: { type: "string", description: "Hostname, such as dreamingwithmarisol.com or lindowlabs.dev." },
      type: {
        type: "string",
        enum: ["page_section", "product", "event", "post", "link"],
        description: "page_section, product, event, post, or link.",
      },
      slug: { type: "string", description: "Lowercase slug, unique on the site." },
      title: { type: "string", description: "Title shown for this item." },
      body: { type: "string", description: "Plain body. Structured copy goes in fields." },
      fields: {
        type: "object",
        description: "Structured fields for this type.",
      },
      noteId: { type: "string", description: "Id of the note this item came from." },
      draftKey: {
        type: "string",
        description: "Idempotency key. The same key returns the original draft.",
      },
      status: {
        type: "string",
        enum: ["draft", "published"],
        description: "Only draft is accepted. published is rejected and nothing is saved.",
      },
    },
    required: ["site", "type", "slug", "title"],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
};


const GET_OUTREACH_SCHEDULE_TOOL = {
  name: "get_outreach_schedule",
  title: "Get outreach schedule",
  description: [
    "Read this connector user's Mon–Fri outreach week: sessions, touches,",
    "North Star company, companies missing a planned next touch, curriculumName,",
    "and busyEvents for the inbox plan.",
    "Optional weekStart, companyId, and touchType filter. A user id in args is ignored.",
    "Does not send messages. There is no /schedule page.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      weekStart: { type: "string", description: "Any date in the week (ISO). Defaults to this week." },
      companyId: { type: "string", description: "Keep only touches for this company id." },
      touchType: {
        type: "string",
        enum: ["application", "referral_outreach", "hiring_leader_outreach", "recruiter_outreach", "referral_follow_up", "call_follow_up"],
        description: "Keep only this touch type.",
      },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};

const SET_BUSY_TIMES_TOOL = {
  name: "set_busy_times",
  title: "Set busy times",
  description: [
    "Replace this connector user's busy blocks for one Mon–Fri week.",
    "Pass weekStart (any date in the week) and blocks: [{ startsAt, endsAt, label? }].",
    "An empty blocks array clears the week. A user id in args is ignored.",
    "The owner's assistant posts blocks from their calendar. Tinker stores them only;",
    "it never talks to Google and never sends messages.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      weekStart: { type: "string", description: "Any date in the week (ISO). Defaults to this week." },
      blocks: {
        type: "array",
        description: "Busy intervals for the week. Replaces the previous set for that week.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            startsAt: { type: "string", description: "Busy interval start (ISO)." },
            endsAt: { type: "string", description: "Busy interval end (ISO)." },
            label: { type: "string", description: "Optional short label." },
          },
          required: ["startsAt", "endsAt"],
        },
      },
    },
    required: ["blocks"],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const LIST_STORY_PARTS_TOOL = {
  name: "list_story_parts",
  title: "List story parts",
  description: [
    "List this connector user's ready story parts for pasting into Formation drafts.",
    "Stages are fixed: hook, proof_point, connecting_story, fit, ask.",
    "Optional filters: stage, concepts, teamOrRole.",
    "concepts are kebab-case tags for fundamental engineering concepts the user stands behind.",
    "Always returns ready parts only. Draft and retired parts are never included.",
    "At most 50 parts. Each item includes id, stage, title, body, fields, topics, concepts, stack,",
    "status, sourceExcerpt, source {kind,id}, checkVerdicts, and checkedAt.",
    "For sourceKind code, also includes sourceRef {repo, path, ref, evidence} as stored.",
    "Parts are the user's approved wording. Paste them as-is. Tinker does not draft or send outreach.",
    "This tool is read-only. It does not mark parts ready or edit them.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      stage: {
        type: "string",
        description: "Stage key: hook, proof_point, connecting_story, fit, or ask.",
      },
      teamOrRole: { type: "string", description: "Fit-stage teamOrRole field." },
      concepts: {
        type: "string",
        description: "Kebab-case concept tag for a fundamental engineering concept the user stands behind.",
      },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};

const GET_STORY_PART_TOOL = {
  name: "get_story_part",
  title: "Read one story part",
  description: [
    "Read one story part that belongs to this connector user.",
    "Pass id. Returns body, fields, topics, concepts, stack, sourceExcerpt, source {kind,id}, checkVerdicts, and checkedAt.",
    "concepts are kebab-case tags for fundamental engineering concepts the user stands behind.",
    "For sourceKind code, also returns sourceRef {repo, path, ref, evidence} as stored.",
    "Someone else's id returns an error and no part.",
    "Parts are the user's approved wording for Formation drafts. Tinker does not draft or send outreach.",
    "This tool is read-only. It does not mark parts ready or edit them.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { id: { type: "string", description: "Part id from list_story_parts." } },
    required: ["id"],
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};

const POST_TO_SELF_THREAD_TOOL = {
  name: "post_to_self_thread",
  title: "Post to self thread",
  description: [
    "Post a short message into this connector user's own You inbox thread in Tinker.",
    "Pass title (short subject) and body (markdown: bold, headings, lists).",
    "Use only for brief personal assistant notes in the owner's story thread.",
    "Do not dump GTM or outreach plans here; use upsert_target_company and upsert_lead_person.",
    "Do not post deploy checks, production status, allowlist/gate notes, or ops chatter.",
    "Does not send email, LinkedIn, or any external message. A user id in args is ignored.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string", description: "Short subject line for the bubble." },
      body: { type: "string", description: "Markdown body shown in the You thread." },
    },
    required: ["title", "body"],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const UPDATE_OWNER_PROFILE_TOOL = {
  name: "update_owner_profile",
  title: "Update owner profile",
  description: [
    "Update optional fields on this connector user's own tinker profile.",
    "Pass title and/or linkedInUrl. Omitted fields stay unchanged.",
    "Pass an empty string to clear a field.",
    "Title shows under the owner name in the inbox and owner header.",
    "linkedInUrl is the owner-thread LinkedIn icon only.",
    "Does not change name, email, or avatar. A user id in args is ignored.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string", description: "Owner title under their name (e.g. Founder at Lindow Labs). Empty string clears." },
      linkedInUrl: { type: "string", description: "Owner LinkedIn profile URL. Empty string clears." },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const CREATE_READING_THREAD_TOOL = {
  name: "create_reading_thread",
  title: "Create reading thread",
  description: [
    "Create a generic reading workbook thread for any book (not book-specific code).",
    "Pass title, optional author, and ordered sections (section title strings).",
    "Generates one pre-read question for the first section using KEEP_CRAFTING_MODEL.",
    "The thread appears in the Tinker inbox like a lead; the owner answers in the notepad.",
    "Does not touch leads or outreach. A user id in args is ignored.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string", description: "Book or workbook title." },
      author: { type: "string", description: "Optional author name." },
      sections: {
        type: "array",
        description: "Ordered section titles the owner will read.",
        items: { type: "string" },
      },
    },
    required: ["title", "sections"],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const LIST_READING_THREADS_TOOL = {
  name: "list_reading_threads",
  title: "List reading threads",
  description: [
    "List this connector user's reading workbook threads.",
    "Returns id, title, author, sections, current section, notes, and done.",
    "Read-only. A user id in args is ignored.",
  ].join(" "),
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};

const GET_READING_THREAD_TOOL = {
  name: "get_reading_thread",
  title: "Get reading thread",
  description: [
    "Read one reading workbook thread by threadId.",
    "Returns sections, current pre-read question, notepad notes, and done.",
    "Read-only. A user id in args is ignored.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      threadId: { type: "string", description: "Reading thread id from create_reading_thread or list_reading_threads." },
    },
    required: ["threadId"],
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};

const ADVANCE_READING_SECTION_TOOL = {
  name: "advance_reading_section",
  title: "Advance reading section",
  description: [
    "Mark the current section done and generate the next section's pre-read question (KEEP_CRAFTING_MODEL).",
    "Pass threadId. Optional notes are merge-safe (same ### __done__ rules as lead notes).",
    "When the last section finishes, the thread notes gain ### __done__.",
    "Does not touch leads. A user id in args is ignored.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      threadId: { type: "string", description: "Reading thread id." },
      notes: { type: "string", description: "Optional notepad markdown to merge before advancing." },
    },
    required: ["threadId"],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const SET_COMPANY_PRIORITY_TOOL = {
  name: "set_company_priority",
  title: "Set company priority",
  description: [
    "Set a target company's inbox priority and optional North Star flag.",
    "Pass companyName (or companyId). priority is an integer; lower sorts first",
    "(after North Star). Creates the company if it does not exist yet.",
    "This shapes how people are grouped in the inbox. Prefer this over prose posts.",
    "A user id in args is ignored.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      companyId: { type: "string", description: "Existing company id." },
      companyName: { type: "string", description: "Company name. Used to find or create." },
      domain: { type: "string", description: "Optional company domain when creating." },
      priority: { type: "integer", description: "Inbox order. Lower comes first. Default 100." },
      northStar: { type: "boolean", description: "When true, this company is the North Star." },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const PLAN_LEAD_TOUCH_TOOL = {
  name: "plan_lead_touch",
  title: "Plan lead touch",
  description: [
    "Set a lead's role in the outreach sequence and their next planned touch.",
    "Pass personName and companyName. contactType is referrer, hiring_leader,",
    "recruiter, or other. touchType is the next step (referral_outreach,",
    "hiring_leader_outreach, recruiter_outreach, referral_follow_up, etc.).",
    "dueDate is when that touch is due (ISO). Optional companyPriority orders",
    "the company group. Creates company/lead/touch as needed and updates open touches.",
    "Prefer this over dumping GTM prose into post_to_self_thread. A user id in args is ignored.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      personName: { type: "string", description: "Lead full name." },
      companyName: { type: "string", description: "Target company name." },
      companyId: { type: "string", description: "Existing company id, if known." },
      domain: { type: "string", description: "Optional company domain when creating." },
      contactType: {
        type: "string",
        enum: ["referrer", "hiring_leader", "recruiter", "other"],
        description: "Role in the sequence: referral, hiring EM, recruiter, or other.",
      },
      queueOrder: { type: "integer", description: "Order within the same contact type. Lower first." },
      companyPriority: { type: "integer", description: "Optional company inbox priority (lower first)." },
      northStar: { type: "boolean", description: "Optional North Star flag for the company." },
      personTitle: { type: "string", description: "Optional title." },
      nextStep: { type: "string", description: "Optional short next-step label." },
      touchType: {
        type: "string",
        enum: ["application", "referral_outreach", "hiring_leader_outreach", "recruiter_outreach", "referral_follow_up", "call_follow_up"],
        description: "Next planned touch type.",
      },
      dueDate: { type: "string", description: "When the next touch is due (ISO date or datetime)." },
    },
    required: ["personName", "companyName", "contactType", "touchType", "dueDate"],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const UPSERT_TARGET_COMPANY_TOOL = {
  name: "upsert_target_company",
  title: "Upsert target company",
  description: [
    "Create or update a target company in the owner's inbox.",
    "Pass name (required to create) or companyId. Optional domain, priority",
    "(lower sorts first), tier (north_star, wave_1, wave_2, other), notes,",
    "research (structured summary / key facts / links), status (active|dropped).",
    "Fields left out are unchanged on update. north_star tier also sets the North Star flag.",
    "Does not send messages. A user id in args is ignored.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      companyId: { type: "string", description: "Existing company id to update." },
      name: { type: "string", description: "Company name (required when creating)." },
      domain: { type: "string", description: "Optional company domain." },
      priority: { type: "integer", description: "Inbox rank. Lower comes first. Default 100." },
      tier: {
        type: "string",
        enum: ["north_star", "wave_1", "wave_2", "other"],
        description: "Company wave / North Star tier.",
      },
      notes: { type: "string", description: "Optional short notes for the company (role, link, fit, gaps, next step)." },
      research: {
        type: "string",
        description: "Optional research summary: key facts, links, or structured findings beyond short notes.",
      },
      status: {
        type: "string",
        enum: ["active", "dropped"],
        description: "active (default) or dropped.",
      },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const UPSERT_LEAD_PERSON_TOOL = {
  name: "upsert_lead_person",
  title: "Upsert lead person",
  description: [
    "Create or update a person under a target company.",
    "Pass personName and companyName (or companyId). contactType is the role",
    "in sequence: referrer, hiring_leader, recruiter, or other.",
    "Optional personTitle, linkedInUrl, githubUrl, email, nextStep, dueDate (ISO),",
    "queueOrder (sequence position), notes (person notepad; merges and keeps ### __done__),",
    "and touchType to plan the next outreach touch.",
    "Omitted fields are left unchanged - email/nextStep updates never wipe notes.",
    "Does not write company notes/research. Does not send email or LinkedIn.",
    "A user id in args is ignored.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      personName: { type: "string", description: "Person full name." },
      companyName: { type: "string", description: "Company name." },
      companyId: { type: "string", description: "Existing company id, if known." },
      domain: { type: "string", description: "Optional company domain when creating the company." },
      contactType: {
        type: "string",
        enum: ["referrer", "hiring_leader", "recruiter", "other"],
        description: "Role: referral, hiring EM, recruiter, or other.",
      },
      personTitle: { type: "string", description: "Optional title." },
      linkedInUrl: { type: "string", description: "Optional LinkedIn URL." },
      githubUrl: { type: "string", description: "Optional GitHub profile URL." },
      email: { type: "string", description: "Optional email." },
      nextStep: { type: "string", description: "Short next-step label." },
      dueDate: { type: "string", description: "When the next step is due (ISO)." },
      queueOrder: { type: "integer", description: "Sequence position within the role. Lower first." },
      notes: {
        type: "string",
        description: "Optional person notepad notes. Merged with existing; a trailing ### __done__ marker is preserved when present on either side.",
      },
      touchType: {
        type: "string",
        enum: ["application", "referral_outreach", "hiring_leader_outreach", "recruiter_outreach", "referral_follow_up", "call_follow_up"],
        description: "Optional planned touch type. When set with dueDate, upserts an outreach touch.",
      },
      companyPriority: { type: "integer", description: "Optional company priority when creating." },
      tier: {
        type: "string",
        enum: ["north_star", "wave_1", "wave_2", "other"],
        description: "Optional company tier when creating.",
      },
    },
    required: ["personName", "companyName", "contactType"],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const MARK_LEAD_DONE_TOOL = {
  name: "mark_lead_done",
  title: "Mark lead Keep crafting done",
  description: [
    "Append ### __done__ to a person's notepad notes without replacing Q&A turns.",
    "Pass personId, or personName with companyName. Use to restore completed",
    "This is everything state when the marker was lost. Idempotent when already done.",
    "Does not regenerate proposedSubject. A user id in args is ignored.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      personId: { type: "string", description: "Existing person (lead) id." },
      personName: { type: "string", description: "Person full name when personId is omitted." },
      companyName: { type: "string", description: "Company name when personId is omitted." },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const LIST_TARGET_COMPANIES_TOOL = {
  name: "list_target_companies",
  title: "List target companies",
  description: [
    "List this connector user's target companies with their people.",
    "Optional status filter (active|dropped). Returns companies ordered by",
    "North Star / priority, each with people (name, title, contactType,",
    "linkedInUrl, githubUrl, nextStep, nextStepAt, queueOrder).",
    "When the owner finished Keep crafting with This is everything, people may",
    "also include proposedSubject — the generated outreach email subject on",
    "their open gmail draft. Use that same subject when composing save_outreach_draft.",
    "Read-only. A user id in args is ignored.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: {
        type: "string",
        enum: ["active", "dropped"],
        description: "Optional status filter. Defaults to active companies only when omitted from the store filter; pass to override.",
      },
    },
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};

const SAVE_OUTREACH_DRAFT_TOOL = {
  name: "save_outreach_draft",
  title: "Save outreach draft for review",
  description: [
    "Store or replace a composed outreach message on a person's Tinker chat for the owner to review.",
    "Pass personName and companyName, or personId. channel is email or linkedin.",
    "Pass to (recipient email or LinkedIn profile URL), subject (required for email, omit for LinkedIn), and body.",
    "Shows as a review card above the owner's notepad with To, Subject, and Body.",
    "Never approves. The owner taps This is everything on that card to approve the exact text.",
    "Owner notes in the notepad stay separate. A user id in args is ignored.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      personId: { type: "string", description: "Existing person (lead) id." },
      personName: { type: "string", description: "Person full name when personId is omitted." },
      companyName: { type: "string", description: "Company name when personId is omitted." },
      channel: {
        type: "string",
        enum: ["email", "linkedin"],
        description: "email → Gmail outreach; linkedin → LinkedIn message.",
      },
      to: { type: "string", description: "Recipient email (email) or LinkedIn profile URL (linkedin)." },
      subject: { type: "string", description: "Email subject. Required for email; omit for LinkedIn." },
      body: { type: "string", description: "Composed message body the owner will review." },
    },
    required: ["channel", "to", "body"],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const LIST_APPROVED_OUTREACH_TOOL = {
  name: "list_approved_outreach",
  title: "List approved outreach",
  description: [
    "List drafts the owner approved with This is everything that are not yet sent.",
    "Only sendable rows are returned (email needs recipient, subject, body; LinkedIn needs profile URL and body).",
    "Non-sendable stuck approvals are revoked back to draft and omitted.",
    "Each row includes id, personName, companyName, email, linkedInUrl, channel,",
    "subject, and the exact approvedText. A bot may send only that exact text,",
    "once per approval. Tinker never sends. A user id in args is ignored.",
  ].join(" "),
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};

const MARK_OUTREACH_SENT_TOOL = {
  name: "mark_outreach_sent",
  title: "Mark outreach sent",
  description: [
    "Mark one outreach draft as sent. Use after a bot delivered an approved_to_send draft,",
    "or to record a send the owner already made outside Tinker for a draft that was never approved.",
    "Pass id, or personId, or personName+companyName to find the open draft.",
    "Optional channel, sentAt (ISO), subject (email), and externalMessageId.",
    "One send per draft; already-sent drafts error. Sent drafts cannot be approved again.",
    "Tinker never sends. A user id in args is ignored.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string", description: "Draft id (from list_approved_outreach or a known draft)." },
      personId: { type: "string", description: "Person (lead) id when id is omitted." },
      personName: { type: "string", description: "Person full name when id and personId are omitted." },
      companyName: { type: "string", description: "Company name with personName." },
      channel: {
        type: "string",
        enum: ["linkedin_post", "linkedin_connection", "gmail_outreach"],
        description: "Channel used to send. Defaults to the draft channel.",
      },
      sentAt: { type: "string", description: "When it was sent (ISO). Default now." },
      subject: { type: "string", description: "Optional email subject to record on the sent draft." },
      externalMessageId: { type: "string", description: "Optional id from the external provider." },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const MARK_OUTREACH_FAILED_TOOL = {
  name: "mark_outreach_failed",
  title: "Mark outreach failed",
  description: [
    "Mark one approved_to_send draft as failed to send. Pass id and reason.",
    "The owner can edit and approve again. Tinker never sends. A user id in args is ignored.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      id: { type: "string", description: "Approved draft id." },
      reason: { type: "string", description: "Why sending failed." },
    },
    required: ["id", "reason"],
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};

const TOOLS = [
  ASK_FOLLOWUPS_TOOL,
  DRAFT_LINKEDIN_TOOL,
  GET_AUTONOMY_SETTINGS_TOOL,
  GET_CAREER_RECORD_TOOL,
  CHECK_TEXT_TOOL,
  LIST_CONTENT_TOOL,
  READ_CONTENT_TOOL,
  CREATE_CONTENT_DRAFT_TOOL,
  LIST_STORY_PARTS_TOOL,
  GET_STORY_PART_TOOL,
  GET_OUTREACH_SCHEDULE_TOOL,
  SET_BUSY_TIMES_TOOL,
  POST_TO_SELF_THREAD_TOOL,
  UPDATE_OWNER_PROFILE_TOOL,
  CREATE_READING_THREAD_TOOL,
  LIST_READING_THREADS_TOOL,
  GET_READING_THREAD_TOOL,
  ADVANCE_READING_SECTION_TOOL,
  SET_COMPANY_PRIORITY_TOOL,
  PLAN_LEAD_TOUCH_TOOL,
  UPSERT_TARGET_COMPANY_TOOL,
  UPSERT_LEAD_PERSON_TOOL,
  MARK_LEAD_DONE_TOOL,
  LIST_TARGET_COMPANIES_TOOL,
  SAVE_OUTREACH_DRAFT_TOOL,
  LIST_APPROVED_OUTREACH_TOOL,
  MARK_OUTREACH_SENT_TOOL,
  MARK_OUTREACH_FAILED_TOOL,
];
const NO_STORE = { "Cache-Control": "no-store" };

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

// mcp_ keys stay off the Stytch path, including typos. A dotted session
// JWT never starts with mcp_, so the two bearers do not overlap.
// Either bearer resolves to the Tinker user it belongs to.
async function authorize(token) {
  if (!token) {
    throw Object.assign(new Error("Missing token."), { status: 401 });
  }
  if (isMcpApiKey(token)) {
    const key = await authenticateMcpKey(token);
    return { userId: key.userId };
  }
  const session = await authenticateSession(token);
  const userId = userIdFromSession(session);
  if (!userId) {
    throw Object.assign(new Error("Session missing user id."), { status: 401 });
  }
  return { userId };
}

function protocolFrom(req) {
  const header = req.headers && (req.headers["mcp-protocol-version"] || req.headers["MCP-Protocol-Version"]);
  return SUPPORTED_PROTOCOLS.includes(header) ? header : DEFAULT_PROTOCOL;
}

function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "MCP-Protocol-Version, WWW-Authenticate",
  );
}

function sendJson(res, status, body, protocol, extra) {
  applyCors(res);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("MCP-Protocol-Version", protocol || DEFAULT_PROTOCOL);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) res.setHeader(key, value);
  }
  res.status(status).json(body);
}

function sendEmpty(res, status, protocol, extra) {
  applyCors(res);
  res.setHeader("MCP-Protocol-Version", protocol || DEFAULT_PROTOCOL);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) res.setHeader(key, value);
  }
  res.status(status).end();
}

function rpcOk(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcErr(id, code, message) {
  return { jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } };
}

function toolError(message) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function readMessage(req) {
  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    if (!body.trim()) return { error: "parse" };
    try {
      body = JSON.parse(body);
    } catch {
      return { error: "parse" };
    }
  }
  if (body == null) return { error: "parse" };
  if (Array.isArray(body)) return { error: "batch" };
  if (typeof body !== "object") return { error: "parse" };
  return { message: body };
}

// McpApiKey.userId is session.user_id from connector approval
// (userIdFromSession). Autonomy hashes use that same session.user_id
// (callerFromSession). The tool reads autonomy:<that id> and ignores
// any user id in the arguments.
async function autonomyCall(msg, user) {
  try {
    const userId = user && typeof user.userId === "string" ? user.userId : "";
    if (!userId) throw new Error("missing user");
    const shaped = toolSettings(await readAll(userId));
    return {
      status: 200,
      headers: NO_STORE,
      body: rpcOk(msg.id, {
        content: [{ type: "text", text: JSON.stringify(shaped, null, 2) }],
        structuredContent: shaped,
      }),
    };
  } catch {
    return {
      status: 200,
      headers: NO_STORE,
      body: rpcOk(msg.id, toolError(UNAVAILABLE)),
    };
  }
}

async function careerReadCall(msg, user) {
  try {
    const userId = user && typeof user.userId === "string" ? user.userId : "";
    if (!userId) throw new Error("missing user");
    const shaped = shapeForTool(await readForTool(userId));
    return {
      status: 200,
      headers: NO_STORE,
      body: rpcOk(msg.id, {
        content: [{ type: "text", text: JSON.stringify(shaped, null, 2) }],
        structuredContent: shaped,
      }),
    };
  } catch {
    return {
      status: 200,
      headers: NO_STORE,
      body: rpcOk(msg.id, toolError(CAREER_UNAVAILABLE)),
    };
  }
}

async function careerCheckCall(msg, user, args) {
  if (!args || typeof args.text !== "string") {
    return {
      status: 200,
      headers: NO_STORE,
      body: rpcOk(msg.id, toolError("text is required.")),
    };
  }
  try {
    const userId = user && typeof user.userId === "string" ? user.userId : "";
    if (!userId) throw new Error("missing user");
    const record = await readForTool(userId);
    let shaped;
    try {
      shaped = await checkText({
        record,
        text: args.text,
        company: typeof args.company === "string" ? args.company : "",
        field_label: typeof args.field_label === "string" ? args.field_label : "",
      });
    } catch {
      return {
        status: 200,
        headers: NO_STORE,
        body: rpcOk(msg.id, toolError("Could not check that text.")),
      };
    }
    return {
      status: 200,
      headers: NO_STORE,
      body: rpcOk(msg.id, {
        content: [{ type: "text", text: JSON.stringify(shaped, null, 2) }],
        structuredContent: shaped,
      }),
    };
  } catch {
    return {
      status: 200,
      headers: NO_STORE,
      body: rpcOk(msg.id, toolError(CAREER_UNAVAILABLE)),
    };
  }
}

function contentUserId(user) {
  const userId = user && typeof user.userId === "string" ? user.userId : "";
  if (!userId) throw Object.assign(new Error("Sign in to tinker first."), { status: 401 });
  return userId;
}

function contentToolFailure(msg, err) {
  const status = err && err.status;
  const message = status && status >= 400 && status < 500
    ? err.message
    : contentStore.UNAVAILABLE;
  return {
    status: 200,
    headers: NO_STORE,
    body: rpcOk(msg.id, toolError(message || contentStore.UNAVAILABLE)),
  };
}

function contentToolOk(msg, shaped) {
  return {
    status: 200,
    headers: NO_STORE,
    body: rpcOk(msg.id, {
      content: [{ type: "text", text: JSON.stringify(shaped, null, 2) }],
      structuredContent: shaped,
    }),
  };
}

async function contentListCall(msg, user, args) {
  try {
    const rows = await contentStore.listContent({
      userId: contentUserId(user),
      site: args.site,
      type: args.type,
      status: args.status,
    });
    return contentToolOk(msg, { items: rows.map(contentStore.presentOwner) });
  } catch (err) {
    return contentToolFailure(msg, err);
  }
}

async function contentReadCall(msg, user, args) {
  try {
    const row = await contentStore.getContent({
      id: args.id,
      userId: contentUserId(user),
    });
    return contentToolOk(msg, { item: contentStore.presentOwner(row) });
  } catch (err) {
    return contentToolFailure(msg, err);
  }
}

async function contentDraftCall(msg, user, args) {
  try {
    const result = await contentStore.createContent({
      userId: contentUserId(user),
      site: args.site,
      type: args.type,
      slug: args.slug,
      title: args.title,
      body: args.body,
      fields: args.fields,
      noteId: args.noteId,
      draftKey: args.draftKey,
      status: args.status,
      allowPublish: false,
    });
    return contentToolOk(msg, {
      created: result.created,
      item: contentStore.presentOwner(result.row),
    });
  } catch (err) {
    return contentToolFailure(msg, err);
  }
}


async function scheduleReadCall(msg, user, args) {
  try {
    const userId = contentUserId(user);
    const shaped = await scheduleStore.getWeekSchedule({
      userId,
      emailHint: user && user.email,
      weekStart: args.weekStart,
      companyId: args.companyId,
      touchType: args.touchType,
    });
    return contentToolOk(msg, shaped);
  } catch (err) {
    const status = err && err.status;
    const message = status && status >= 400 && status < 500
      ? err.message
      : scheduleStore.UNAVAILABLE;
    return {
      status: 200,
      headers: NO_STORE,
      body: rpcOk(msg.id, toolError(message || scheduleStore.UNAVAILABLE)),
    };
  }
}

async function scheduleBusyCall(msg, user, args) {
  try {
    const userId = contentUserId(user);
    const shaped = await scheduleStore.setBusyTimes({
      userId,
      emailHint: user && user.email,
      actor: { kind: "bot", label: "bot:mcp" },
      weekStart: args.weekStart,
      blocks: args.blocks,
    });
    return contentToolOk(msg, shaped);
  } catch (err) {
    const status = err && err.status;
    const message = status && status >= 400 && status < 500
      ? err.message
      : scheduleStore.UNAVAILABLE;
    return {
      status: 200,
      headers: NO_STORE,
      body: rpcOk(msg.id, toolError(message || scheduleStore.UNAVAILABLE)),
    };
  }
}

function storyUserId(user) {
  const userId = user && typeof user.userId === "string" ? user.userId : "";
  if (!userId) throw Object.assign(new Error("Sign in to tinker first."), { status: 401 });
  return userId;
}

function storyFailure(msg, err) {
  const status = err && err.status;
  const message = status && status >= 400 && status < 500 ? err.message : storyParts.UNAVAILABLE;
  return { status: 200, headers: NO_STORE, body: rpcOk(msg.id, toolError(message || storyParts.UNAVAILABLE)) };
}

async function storyListCall(msg, user, args) {
  try {
    const userId = storyUserId(user);
    const rows = await storyParts.listParts({
      userId, stage: args.stage, concepts: args.concepts, teamOrRole: args.teamOrRole,
      status: "ready", limit: 50,
    });
    return contentToolOk(msg, { parts: rows.map((row) => storyParts.presentMcp(row)) });
  } catch (err) { return storyFailure(msg, err); }
}

async function storyGetCall(msg, user, args) {
  try {
    const row = await storyParts.getPart({ id: args.id, userId: storyUserId(user) });
    return contentToolOk(msg, { part: storyParts.presentMcp(row) });
  } catch (err) { return storyFailure(msg, err); }
}

async function selfThreadCall(msg, user, args) {
  try {
    const userId = storyUserId(user);
    const message = await selfThread.postMessage({
      userId,
      title: args.title,
      body: args.body,
      source: "mcp",
    });
    return contentToolOk(msg, { message });
  } catch (err) {
    const status = err && err.status;
    const message = status && status >= 400 && status < 500 ? err.message : selfThread.UNAVAILABLE;
    return {
      status: 200,
      headers: NO_STORE,
      body: rpcOk(msg.id, toolError(message || selfThread.UNAVAILABLE)),
    };
  }
}

function readingFailure(msg, err) {
  const status = err && err.status;
  const message = status && status >= 400 && status < 500
    ? err.message
    : readingThreads.UNAVAILABLE;
  return {
    status: 200,
    headers: NO_STORE,
    body: rpcOk(msg.id, toolError(message || readingThreads.UNAVAILABLE)),
  };
}

async function createReadingThreadCall(msg, user, args) {
  try {
    const thread = await readingThreads.createThread({
      userId: storyUserId(user),
      title: args.title,
      author: args.author,
      sections: args.sections,
    });
    return contentToolOk(msg, { thread });
  } catch (err) { return readingFailure(msg, err); }
}

async function listReadingThreadsCall(msg, user) {
  try {
    const threads = await readingThreads.listThreads({ userId: storyUserId(user) });
    return contentToolOk(msg, { threads });
  } catch (err) { return readingFailure(msg, err); }
}

async function getReadingThreadCall(msg, user, args) {
  try {
    const thread = await readingThreads.getThread({
      userId: storyUserId(user),
      threadId: args.threadId,
    });
    return contentToolOk(msg, { thread });
  } catch (err) { return readingFailure(msg, err); }
}

async function advanceReadingSectionCall(msg, user, args) {
  try {
    const thread = await readingThreads.advanceSection({
      userId: storyUserId(user),
      threadId: args.threadId,
      notes: Object.prototype.hasOwnProperty.call(args, "notes") ? args.notes : undefined,
    });
    return contentToolOk(msg, { thread });
  } catch (err) { return readingFailure(msg, err); }
}

function trimOwnerField(value, label, max) {
  const text = String(value == null ? "" : value).trim();
  if (text.length > max) {
    throw Object.assign(new Error(label + " is too long."), { status: 400 });
  }
  return text;
}

function presentOwnerProfile(data) {
  const row = data && typeof data === "object" ? data : {};
  return {
    name: row.name ? String(row.name) : "",
    title: row.title ? String(row.title) : "",
    linkedInUrl: row.linkedInUrl || row.linkedinUrl
      ? String(row.linkedInUrl || row.linkedinUrl)
      : "",
  };
}

async function updateOwnerProfileCall(msg, user, args) {
  try {
    const userId = contentUserId(user);
    if (!hasOwn(args, "title") && !hasOwn(args, "linkedInUrl")) {
      throw Object.assign(new Error("Pass title and/or linkedInUrl."), { status: 400 });
    }
    const existing = await prisma.tinkerUserData.findUnique({
      where: { userId_kind: { userId, kind: "profile" } },
    });
    const base = existing && existing.data && typeof existing.data === "object" ? existing.data : {};
    const next = Object.assign({}, base);
    if (hasOwn(args, "title")) {
      next.title = trimOwnerField(args.title, "title", 120);
    }
    if (hasOwn(args, "linkedInUrl")) {
      const url = trimOwnerField(args.linkedInUrl, "linkedInUrl", 500);
      if (url && !/^https?:\/\//i.test(url)) {
        throw Object.assign(new Error("linkedInUrl must start with http:// or https://."), { status: 400 });
      }
      next.linkedInUrl = url;
      delete next.linkedinUrl;
    }
    const saved = await prisma.tinkerUserData.upsert({
      where: { userId_kind: { userId, kind: "profile" } },
      create: { userId, kind: "profile", data: next },
      update: { data: next },
    });
    return contentToolOk(msg, { profile: presentOwnerProfile(saved.data) });
  } catch (err) {
    const status = err && err.status;
    const message = status && status >= 400 && status < 500
      ? err.message
      : OWNER_PROFILE_UNAVAILABLE;
    return {
      status: 200,
      headers: NO_STORE,
      body: rpcOk(msg.id, toolError(message || OWNER_PROFILE_UNAVAILABLE)),
    };
  }
}

function planFailure(msg, err, fallback) {
  const status = err && err.status;
  const message = status && status >= 400 && status < 500 ? err.message : fallback;
  return {
    status: 200,
    headers: NO_STORE,
    body: rpcOk(msg.id, toolError(message || fallback)),
  };
}

function nameMatch(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
function companyPatchFromArgs(args) {
  // Only fields explicitly passed (and not undefined) become updates.
  // Omitted fields must never wipe existing company data.
  const patch = {};
  if (hasOwn(args, "priority") && args.priority !== undefined && args.priority !== null) {
    patch.priority = args.priority;
  } else if (hasOwn(args, "companyPriority") && args.companyPriority !== undefined && args.companyPriority !== null) {
    patch.priority = args.companyPriority;
  }
  if (hasOwn(args, "northStar") && args.northStar !== undefined) patch.northStar = args.northStar;
  if (hasOwn(args, "tier") && args.tier != null) patch.tier = args.tier;
  if (hasOwn(args, "notes") && args.notes !== undefined) patch.notes = args.notes;
  if (hasOwn(args, "research") && args.research !== undefined) patch.research = args.research;
  if (hasOwn(args, "status") && args.status != null) patch.status = args.status;
  if (hasOwn(args, "domain") && args.domain !== undefined) patch.domain = args.domain;
  if (hasOwn(args, "name") && args.name != null) patch.name = args.name;
  return patch;
}
function companyArgsFromLeadUpsert(args) {
  // Person upserts must never forward notes/research onto the company -
  // those fields are company-only (upsert_target_company). Forwarding them
  // let a lead-field update wipe company notepad copy.
  const out = {};
  if (hasOwn(args, "companyId")) out.companyId = args.companyId;
  if (hasOwn(args, "companyName")) out.companyName = args.companyName;
  if (hasOwn(args, "domain")) out.domain = args.domain;
  if (hasOwn(args, "companyPriority")) out.companyPriority = args.companyPriority;
  if (hasOwn(args, "priority")) out.priority = args.priority;
  if (hasOwn(args, "tier")) {
    out.tier = args.tier;
    if (args.tier === "north_star") out.northStar = true;
  }
  if (hasOwn(args, "status")) out.status = args.status;
  if (hasOwn(args, "northStar") && args.northStar !== undefined) out.northStar = args.northStar;
  return out;
}
function companyArgsFromUpsert(args) {
  const out = {};
  if (hasOwn(args, "companyId")) out.companyId = args.companyId;
  if (hasOwn(args, "companyName") || hasOwn(args, "name")) {
    out.companyName = args.companyName || args.name;
    if (hasOwn(args, "name")) out.name = args.name;
  }
  if (hasOwn(args, "domain")) out.domain = args.domain;
  if (hasOwn(args, "priority")) out.priority = args.priority;
  if (hasOwn(args, "tier")) {
    out.tier = args.tier;
    if (args.tier === "north_star") out.northStar = true;
  } else if (hasOwn(args, "northStar") && args.northStar !== undefined) {
    out.northStar = args.northStar;
  }
  if (hasOwn(args, "notes")) out.notes = args.notes;
  if (hasOwn(args, "research")) out.research = args.research;
  if (hasOwn(args, "status")) out.status = args.status;
  return out;
}

async function resolveCompany(user, args) {
  const userId = contentUserId(user);
  const emailHint = user && user.email;
  const actor = MCP_BOT_ACTOR;
  await companiesStore.ensureTable();
  if (args.companyId) {
    const row = await companiesStore.loadCompany(args.companyId, userId);
    const patch = companyPatchFromArgs(args);
    if (Object.keys(patch).length) {
      return companiesStore.updateCompany({ id: row.id, userId, emailHint, actor, patch });
    }
    return row;
  }
  const companyName = typeof args.companyName === "string"
    ? args.companyName.trim()
    : (typeof args.name === "string" ? args.name.trim() : "");
  if (!companyName) throw Object.assign(new Error("companyName or name is required."), { status: 400 });
  const listed = await companiesStore.listCompanies({ userId, emailHint });
  let found = listed.find((row) => nameMatch(row.name, companyName));
  if (!found) {
    found = await companiesStore.createCompany({
      userId,
      emailHint,
      actor,
      name: companyName,
      domain: args.domain,
      northStar: !!args.northStar || args.tier === "north_star",
      tier: args.tier,
      notes: args.notes,
      research: args.research,
      priority: args.priority != null ? args.priority : (args.companyPriority != null ? args.companyPriority : 100),
      status: args.status || "active",
    });
  } else {
    const patch = companyPatchFromArgs(args);
    if (Object.keys(patch).length) {
      found = await companiesStore.updateCompany({ id: found.id, userId, emailHint, actor, patch });
    }
  }
  return found;
}

async function setCompanyPriorityCall(msg, user, args) {
  try {
    if (args.priority == null && !Object.prototype.hasOwnProperty.call(args, "northStar") && !args.companyId && !args.companyName) {
      throw Object.assign(new Error("companyName or companyId is required."), { status: 400 });
    }
    const company = await resolveCompany(user, args);
    return contentToolOk(msg, { company: companiesStore.presentCompany(company) });
  } catch (err) {
    return planFailure(msg, err, companiesStore.UNAVAILABLE);
  }
}

async function planLeadTouchCall(msg, user, args) {
  try {
    const userId = contentUserId(user);
    const emailHint = user && user.email;
    const actor = MCP_BOT_ACTOR;
    const personName = typeof args.personName === "string" ? args.personName.trim() : "";
    if (!personName) throw Object.assign(new Error("personName is required."), { status: 400 });
    const company = await resolveCompany(user, companyArgsFromLeadUpsert(args));
    const leads = await leadsStore.listLeads({ userId, emailHint });
    let lead = leads.find((row) => nameMatch(row.personName, personName)
      && (row.companyId === company.id || nameMatch(row.company, company.name)));
    if (!lead) {
      lead = await leadsStore.createLead({
        userId,
        emailHint,
        actor,
        personName,
        personTitle: args.personTitle,
        company: company.name,
        companyId: company.id,
        contactType: args.contactType,
        queueOrder: args.queueOrder,
        nextStep: args.nextStep,
        nextStepAt: args.dueDate,
        source: "other",
        stage: "new",
      });
    } else {
      const patch = {
        contactType: args.contactType,
        company: company.name,
        companyId: company.id,
        nextStepAt: args.dueDate,
      };
      if (args.queueOrder != null) patch.queueOrder = args.queueOrder;
      if (args.personTitle != null) patch.personTitle = args.personTitle;
      if (args.nextStep != null) patch.nextStep = args.nextStep;
      lead = await leadsStore.updateLead({
        id: lead.id,
        userId,
        emailHint,
        actor,
        patch,
      });
    }
    const inbox = await scheduleStore.listInboxTouches({ userId, emailHint });
    const open = inbox && inbox.byLeadId && inbox.byLeadId[lead.id];
    let touch;
    if (open && open.touch && (open.touch.status === "planned" || open.touch.status === "drafted")) {
      touch = await scheduleStore.updateTouch({
        id: open.touch.id,
        userId,
        emailHint,
        actor,
        patch: {
          companyId: company.id,
          touchType: args.touchType,
          date: args.dueDate,
          leadId: lead.id,
          status: "planned",
        },
      });
    } else {
      touch = await scheduleStore.createTouch({
        userId,
        emailHint,
        actor,
        companyId: company.id,
        touchType: args.touchType,
        date: args.dueDate,
        leadId: lead.id,
        status: "planned",
      });
    }
    return contentToolOk(msg, {
      company: companiesStore.presentCompany(company),
      lead: leadsStore.presentLead(lead),
      touch: scheduleStore.presentTouch(touch),
    });
  } catch (err) {
    return planFailure(msg, err, leadsStore.UNAVAILABLE || companiesStore.UNAVAILABLE);
  }
}

async function upsertTargetCompanyCall(msg, user, args) {
  try {
    if (!args.companyId && !(args.name || args.companyName)) {
      throw Object.assign(new Error("name or companyId is required."), { status: 400 });
    }
    const company = await resolveCompany(user, companyArgsFromUpsert(args));
    return contentToolOk(msg, { company: companiesStore.presentCompany(company) });
  } catch (err) {
    return planFailure(msg, err, companiesStore.UNAVAILABLE);
  }
}

async function upsertLeadPersonCall(msg, user, args) {
  try {
    const userId = contentUserId(user);
    const emailHint = user && user.email;
    const actor = MCP_BOT_ACTOR;
    const personName = typeof args.personName === "string" ? args.personName.trim() : "";
    if (!personName) throw Object.assign(new Error("personName is required."), { status: 400 });
    if (!args.contactType) throw Object.assign(new Error("contactType is required."), { status: 400 });
    const company = await resolveCompany(user, companyArgsFromLeadUpsert(args));
    const leads = await leadsStore.listLeads({ userId, emailHint });
    let lead = leads.find((row) => nameMatch(row.personName, personName)
      && (row.companyId === company.id || nameMatch(row.company, company.name)));
    if (!lead) {
      lead = await leadsStore.createLead({
        userId,
        emailHint,
        actor,
        personName,
        personTitle: args.personTitle,
        linkedInUrl: args.linkedInUrl,
        githubUrl: args.githubUrl,
        email: args.email,
        company: company.name,
        companyId: company.id,
        contactType: args.contactType,
        queueOrder: args.queueOrder,
        nextStep: args.nextStep,
        nextStepAt: args.dueDate,
        notes: args.notes,
        source: "other",
        stage: "new",
      });
    } else {
      const patch = {
        contactType: args.contactType,
        company: company.name,
        companyId: company.id,
      };
      if (args.queueOrder != null) patch.queueOrder = args.queueOrder;
      if (args.personTitle != null) patch.personTitle = args.personTitle;
      if (args.linkedInUrl != null) patch.linkedInUrl = args.linkedInUrl;
      if (args.githubUrl != null) patch.githubUrl = args.githubUrl;
      if (args.email != null) patch.email = args.email;
      if (args.nextStep != null) patch.nextStep = args.nextStep;
      if (args.dueDate != null) patch.nextStepAt = args.dueDate;
      if (args.notes != null) patch.notes = args.notes;
      lead = await leadsStore.updateLead({ id: lead.id, userId, emailHint, actor, patch });
    }
    let touch = null;
    if (args.touchType && args.dueDate) {
      const inbox = await scheduleStore.listInboxTouches({ userId, emailHint });
      const open = inbox && inbox.byLeadId && inbox.byLeadId[lead.id];
      if (open && open.touch && (open.touch.status === "planned" || open.touch.status === "drafted")) {
        touch = await scheduleStore.updateTouch({
          id: open.touch.id, userId, emailHint, actor,
          patch: {
            companyId: company.id, touchType: args.touchType, date: args.dueDate,
            leadId: lead.id, status: "planned",
          },
        });
      } else {
        touch = await scheduleStore.createTouch({
          userId, emailHint, actor, companyId: company.id,
          touchType: args.touchType, date: args.dueDate, leadId: lead.id, status: "planned",
        });
      }
    }
    return contentToolOk(msg, {
      company: companiesStore.presentCompany(company),
      lead: leadsStore.presentLead(lead),
      touch: touch ? scheduleStore.presentTouch(touch) : null,
    });
  } catch (err) {
    return planFailure(msg, err, leadsStore.UNAVAILABLE || companiesStore.UNAVAILABLE);
  }
}

async function resolveLeadPerson(user, args) {
  const userId = contentUserId(user);
  const emailHint = user && user.email;
  if (args.personId) {
    const found = await leadsStore.getLead({ id: args.personId, userId, emailHint });
    return found.lead;
  }
  const personName = typeof args.personName === "string" ? args.personName.trim() : "";
  const companyName = typeof args.companyName === "string" ? args.companyName.trim() : "";
  if (!personName || !companyName) {
    throw Object.assign(new Error("personId, or personName and companyName, is required."), { status: 400 });
  }
  const leads = await leadsStore.listLeads({ userId, emailHint });
  const lead = leads.find((row) => nameMatch(row.personName, personName) && nameMatch(row.company, companyName));
  if (!lead) throw Object.assign(new Error("Person not found."), { status: 404 });
  return lead;
}

async function markLeadDoneCall(msg, user, args) {
  try {
    const userId = contentUserId(user);
    const emailHint = user && user.email;
    const actor = MCP_BOT_ACTOR;
    const lead = await resolveLeadPerson(user, args);
    const saved = await leadsStore.markLeadDone({ id: lead.id, userId, emailHint, actor });
    return contentToolOk(msg, { lead: leadsStore.presentLead(saved) });
  } catch (err) {
    return planFailure(msg, err, leadsStore.UNAVAILABLE);
  }
}

async function listTargetCompaniesCall(msg, user, args) {
  try {
    const userId = contentUserId(user);
    const emailHint = user && user.email;
    const status = args.status || "active";
    const companies = await companiesStore.listCompanies({ userId, emailHint, status });
    const leads = await leadsStore.listLeads({ userId, emailHint });
    const subjects = await leadsStore.proposedSubjectByLeadIds({
      userId,
      emailHint,
      leadIds: leads.map((row) => row.id),
    }).catch(() => ({}));
    const shaped = companies.map((company) => {
      const people = leads
        .filter((row) => row.companyId === company.id || nameMatch(row.company, company.name))
        .map((row) => {
          const person = leadsStore.presentLead(row);
          const proposedSubject = subjects[row.id] || "";
          if (proposedSubject) person.proposedSubject = proposedSubject;
          return person;
        });
      return { company: companiesStore.presentCompany(company), people };
    });
    return contentToolOk(msg, { companies: shaped });
  } catch (err) {
    return planFailure(msg, err, companiesStore.UNAVAILABLE);
  }
}

async function saveOutreachDraftCall(msg, user, args) {
  try {
    const userId = contentUserId(user);
    const emailHint = user && user.email;
    const personId = typeof args.personId === "string" ? args.personId.trim() : "";
    const personName = typeof args.personName === "string" ? args.personName.trim() : "";
    const companyName = typeof args.companyName === "string" ? args.companyName.trim() : "";
    if (!personId && !(personName && companyName)) {
      throw Object.assign(new Error("Pass personId, or personName and companyName."), { status: 400 });
    }
    const result = await leadsStore.saveOutreachDraft({
      userId,
      emailHint,
      actor: MCP_BOT_ACTOR,
      personId: personId || undefined,
      personName: personName || undefined,
      companyName: companyName || undefined,
      channel: args.channel,
      to: args.to,
      subject: args.subject,
      body: args.body,
    });
    return contentToolOk(msg, {
      draft: leadsStore.presentDraft(result.draft),
      lead: leadsStore.presentLead(result.lead),
      approved: false,
    });
  } catch (err) {
    return planFailure(msg, err, leadsStore.UNAVAILABLE);
  }
}

async function listApprovedOutreachCall(msg, user) {
  try {
    const userId = contentUserId(user);
    const emailHint = user && user.email;
    const outreach = await leadsStore.listApprovedOutreach({ userId, emailHint });
    return contentToolOk(msg, { outreach });
  } catch (err) {
    return planFailure(msg, err, leadsStore.UNAVAILABLE);
  }
}

async function markOutreachSentCall(msg, user, args) {
  try {
    const userId = contentUserId(user);
    const emailHint = user && user.email;
    const id = typeof args.id === "string" ? args.id.trim() : "";
    const personId = typeof args.personId === "string" ? args.personId.trim() : "";
    const personName = typeof args.personName === "string" ? args.personName.trim() : "";
    const companyName = typeof args.companyName === "string" ? args.companyName.trim() : "";
    if (!id && !personId && !(personName && companyName)) {
      throw Object.assign(
        new Error("id or personId (or personName and companyName) is required."),
        { status: 400 },
      );
    }
    const result = await leadsStore.markDraftSent({
      id: id || undefined,
      personId: personId || undefined,
      personName: personName || undefined,
      companyName: companyName || undefined,
      userId,
      emailHint,
      actor: MCP_BOT_ACTOR,
      channel: args.channel,
      sentAt: args.sentAt,
      subject: args.subject,
      externalMessageId: args.externalMessageId,
    });
    return contentToolOk(msg, {
      draft: leadsStore.presentDraft(result.draft),
      lead: result.lead ? leadsStore.presentLead(result.lead) : null,
    });
  } catch (err) {
    return planFailure(msg, err, leadsStore.UNAVAILABLE);
  }
}

async function markOutreachFailedCall(msg, user, args) {
  try {
    const userId = contentUserId(user);
    const emailHint = user && user.email;
    const id = typeof args.id === "string" ? args.id.trim() : "";
    if (!id) throw Object.assign(new Error("id is required."), { status: 400 });
    const result = await leadsStore.markDraftFailed({
      id,
      userId,
      emailHint,
      actor: MCP_BOT_ACTOR,
      reason: args.reason,
    });
    return contentToolOk(msg, { draft: leadsStore.presentDraft(result.draft) });
  } catch (err) {
    return planFailure(msg, err, leadsStore.UNAVAILABLE);
  }
}

async function handleRpc(msg, user) {
  if (!msg || typeof msg.method !== "string" || msg.jsonrpc !== "2.0") {
    return { status: 400, body: rpcErr(msg && msg.id, -32600, "Invalid Request") };
  }
  const method = msg.method;
  const isNotification = !Object.prototype.hasOwnProperty.call(msg, "id");
  if (isNotification || method.startsWith("notifications/")) {
    return { status: 202, empty: true };
  }

  if (method === "initialize") {
    const params = msg.params || {};
    const clientVersion = params.protocolVersion;
    const negotiated = SUPPORTED_PROTOCOLS.includes(clientVersion)
      ? clientVersion
      : DEFAULT_PROTOCOL;
    return {
      status: 200,
      protocol: negotiated,
      body: rpcOk(msg.id, {
        protocolVersion: negotiated,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "tinker", version: pkg.version || "0.0.0" },
        instructions: INSTRUCTIONS,
      }),
    };
  }
  if (method === "ping") {
    return { status: 200, body: rpcOk(msg.id, {}) };
  }
  if (method === "tools/list") {
    return { status: 200, body: rpcOk(msg.id, { tools: TOOLS }) };
  }
  if (method === "prompts/list") {
    return { status: 200, body: rpcOk(msg.id, { prompts: [] }) };
  }
  if (method === "resources/list") {
    return { status: 200, body: rpcOk(msg.id, { resources: [] }) };
  }
  if (method === "tools/call") {
    const params = msg.params && typeof msg.params === "object" ? msg.params : {};
    const name = params.name;
    const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
    if (
      name !== "ask_followups"
      && name !== "draft_linkedin_post"
      && name !== "get_autonomy_settings"
      && name !== "get_career_record"
      && name !== "check_text"
      && name !== "list_content"
      && name !== "read_content"
      && name !== "create_content_draft"
      && name !== "list_story_parts"
      && name !== "get_story_part"
      && name !== "get_outreach_schedule"
      && name !== "set_busy_times"
      && name !== "post_to_self_thread"
      && name !== "update_owner_profile"
      && name !== "create_reading_thread"
      && name !== "list_reading_threads"
      && name !== "get_reading_thread"
      && name !== "advance_reading_section"
      && name !== "set_company_priority"
      && name !== "plan_lead_touch"
      && name !== "upsert_target_company"
      && name !== "upsert_lead_person"
      && name !== "mark_lead_done"
      && name !== "list_target_companies"
      && name !== "save_outreach_draft"
      && name !== "list_approved_outreach"
      && name !== "mark_outreach_sent"
      && name !== "mark_outreach_failed"
    ) {
      return {
        status: 200,
        body: rpcOk(msg.id, toolError(`Unknown tool: ${name || "(missing)"}`)),
      };
    }
    if (name === "get_autonomy_settings") {
      return autonomyCall(msg, user);
    }
    if (name === "get_career_record") {
      return careerReadCall(msg, user);
    }
    if (name === "check_text") {
      return careerCheckCall(msg, user, args);
    }
    if (name === "list_content") {
      return contentListCall(msg, user, args);
    }
    if (name === "read_content") {
      return contentReadCall(msg, user, args);
    }
    if (name === "create_content_draft") {
      return contentDraftCall(msg, user, args);
    }
    if (name === "list_story_parts") {
      return storyListCall(msg, user, args);
    }
    if (name === "get_story_part") {
      return storyGetCall(msg, user, args);
    }
    if (name === "get_outreach_schedule") {
      return scheduleReadCall(msg, user, args);
    }
    if (name === "set_busy_times") {
      return scheduleBusyCall(msg, user, args);
    }
    if (name === "post_to_self_thread") {
      return selfThreadCall(msg, user, args);
    }
    if (name === "update_owner_profile") {
      return updateOwnerProfileCall(msg, user, args);
    }
    if (name === "create_reading_thread") {
      return createReadingThreadCall(msg, user, args);
    }
    if (name === "list_reading_threads") {
      return listReadingThreadsCall(msg, user);
    }
    if (name === "get_reading_thread") {
      return getReadingThreadCall(msg, user, args);
    }
    if (name === "advance_reading_section") {
      return advanceReadingSectionCall(msg, user, args);
    }
    if (name === "set_company_priority") {
      return setCompanyPriorityCall(msg, user, args);
    }
    if (name === "plan_lead_touch") {
      return planLeadTouchCall(msg, user, args);
    }
    if (name === "upsert_target_company") {
      return upsertTargetCompanyCall(msg, user, args);
    }
    if (name === "upsert_lead_person") {
      return upsertLeadPersonCall(msg, user, args);
    }
    if (name === "mark_lead_done") {
      return markLeadDoneCall(msg, user, args);
    }
    if (name === "list_target_companies") {
      return listTargetCompaniesCall(msg, user, args);
    }
    if (name === "save_outreach_draft") {
      return saveOutreachDraftCall(msg, user, args);
    }
    if (name === "list_approved_outreach") {
      return listApprovedOutreachCall(msg, user, args);
    }
    if (name === "mark_outreach_sent") {
      return markOutreachSentCall(msg, user, args);
    }
    if (name === "mark_outreach_failed") {
      return markOutreachFailedCall(msg, user, args);
    }
    try {
      if (name === "draft_linkedin_post") {
        const shaped = await draftLinkedInPost(args);
        return {
          status: 200,
          body: rpcOk(msg.id, {
            content: [{ type: "text", text: shaped.post }],
            structuredContent: shaped,
          }),
        };
      }
      const shaped = await askFollowups(args);
      return {
        status: 200,
        body: rpcOk(msg.id, {
          content: [{ type: "text", text: JSON.stringify(shaped, null, 2) }],
          structuredContent: shaped,
        }),
      };
    } catch (err) {
      if (err && (err.toolError || err.status === 502 || err.status === 503)) {
        return { status: 200, body: rpcOk(msg.id, toolError(err.message || "Tool failed")) };
      }
      return { status: 500, body: rpcErr(msg.id, -32603, "Internal error") };
    }
  }
  return { status: 200, body: rpcErr(msg.id, -32601, `Method not found: ${method}`) };
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method === "OPTIONS") {
    applyCors(res);
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
    );
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).end();
    return;
  }

  const token = extractBearer(req.headers && req.headers.authorization);
  let caller;
  try {
    caller = await authorize(token); // principal is the approving user, or the session user
  } catch (err) {
    const status = err.status || 401;
    const extra = status === 401 ? { "WWW-Authenticate": wwwAuthenticate(req) } : undefined;
    sendJson(res, status, { error: err.message || "Unauthorized" }, protocolFrom(req), extra);
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" }, protocolFrom(req), { Allow: "POST" });
    return;
  }

  const parsed = readMessage(req);
  if (parsed.error === "parse") {
    sendJson(res, 400, rpcErr(null, -32700, "Parse error"), protocolFrom(req));
    return;
  }
  if (parsed.error === "batch") {
    sendJson(
      res,
      400,
      rpcErr(null, -32600, "JSON-RPC batches are not supported"),
      protocolFrom(req),
    );
    return;
  }

  const outcome = await handleRpc(parsed.message, caller);
  const protocol = outcome.protocol || protocolFrom(req);
  if (outcome.empty) {
    sendEmpty(res, outcome.status, protocol);
    return;
  }
  sendJson(res, outcome.status, outcome.body, protocol, outcome.headers);
});
