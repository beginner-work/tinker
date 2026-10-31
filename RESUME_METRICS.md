# Resume metrics contract

This file is the **guardrail contract** for every resume line item that
Tinker reports about the reading agent and SDK embeds. Numbers on a
resume, in a pitch, or in a dashboard must map to one definition here.

Source of truth for durable counts: Prisma (`ReadingSession`,
`ReadingQuestion`, `ReadingEmbedHost`, `EvalRun`). Vercel Web Analytics
custom events are the dashboard mirror. Typed event names live in
`src/renderer/lib/metrics/events.js` (the module the CI drift test
locks to this file). Emit only through `api/_lib/metrics/emit.js`
(server) or `src/renderer/lib/metrics/client-track.js` (browser).

Read-only aggregate: `GET /api/metrics` (service token or owner session).

## Rules

1. **Event names are a contract.** Any PR that renames or removes an
   event must update this file in the same change. CI fails if this
   file and `src/renderer/lib/metrics/events.js` drift apart (missing or
   extra names). Do not call `@vercel/analytics` `track()` ad hoc with
   these names.
2. **Goal numbers live only in files named `DO_NOT_PUBLISH`.** Never
   commit goal targets or achieved results into this repo as published
   facts. This file defines *how* to measure; it does not store *what
   we hit*.
3. **Owner traffic is always excluded.** Owner means explicit
   `?owner=1` (and the matching `isOwner` flag on persisted rows).
   Untagged traffic is never the owner. Server emit, client
   `beforeSend`, and every `/api/metrics` query drop owner rows.

## Metric map

| Resume line | Exact definition | Event name (as emitted) | Query / `/api/metrics` field |
| --- | --- | --- | --- |
| **Users** | Distinct first-party anonymous ids (`ra_…`) that **started a reading session and asked ≥1 successful question**, with `isOwner = false`. | `session_start` (session create) **and** `question_asked` (successful ask). A user counts only when both exist for that id. | `users` — `COUNT(DISTINCT anonymousId)` over non-owner sessions that also appear on non-owner `ReadingQuestion` rows with `status = "ok"`. |
| **Questions** | Total successful interrupt questions (`ReadingQuestion.status = "ok"`, `isOwner = false`). | `question_asked` | `questions` |
| **Questions per session** | `questions / sessionsWith≥1Question` among non-owner sessions that have at least one ok question. Rounded to 2 decimals. | Derived from `question_asked` (+ session rows). | `questionsPerSession` |
| **Repeat users** | Resume **users** (same definition as Users) with **≥2** non-owner `ReadingSession` rows. | Derived from `session_start` (+ user filter via `question_asked`). | `repeatUsers` |
| **SDK embed hosts** | Distinct hostnames that loaded the reading widget / embed SDK, excluding `lindowlabs.dev`, `localhost`, Vercel preview hosts (`*.vercel.app`), and first-party Tinker hosts (`*.beginner.work`). | `sdk_loaded` (property `host`) | `embedHosts` — hosts from `ReadingEmbedHost` after the same exclusion list (`src/renderer/lib/metrics/events.js` `isExcludedEmbedHost`). |
| **Eval pass rate** | Latest Braintrust / ask-eval gate run: pass rate in `[0, 1]`, with case count and timestamp. | *(no Web Analytics event — persisted only)* | `latestEvalPassRate` — `{ passRate, caseCount, passedCount, failedCount, project, at, experimentUrl }` from newest `EvalRun`. Written by `POST /api/metrics?action=record_eval`. |
| **Users per month** | Resume users bucketed by **calendar month of their first ok question** (UTC `YYYY-MM`). | Derived from `question_asked`. | `usersPerMonth` — `[{ month, users }, …]` |
| **Users (30-day total)** | Resume users who asked at least one ok question in the trailing 30 days from `generatedAt`. **Not** the same as a calendar month in `usersPerMonth`. | Derived from `question_asked`. | `usersLast30Days` |

### Event property keys

Shared keys (string/number/boolean only) are defined next to the event
names in `src/renderer/lib/metrics/events.js` (`PROPS`):

| Key | Used by |
| --- | --- |
| `anonymousId` | `session_start`, `question_asked`, `sdk_loaded`, `answer_link_click` |
| `sessionId` | `session_start`, `question_asked`, `answer_link_click` |
| `host` | `sdk_loaded` (embed hostname) |
| `sourceHost` | article `companyHost` on session/ask/click |
| `target` | `answer_link_click` (`linkedin` \| `email` \| `source`) |
| `input` | `question_asked` (`voice` \| `typed`) |

`answer_link_click` is emitted for LinkedIn / email / original-source
clicks out of the reading answer UI. It is instrumentation for funnel
follow-up; it is not a resume line item above.

### Endpoint shape (`GET /api/metrics`)

```json
{
  "users": 0,
  "questions": 0,
  "questionsPerSession": 0,
  "repeatUsers": 0,
  "embedHosts": ["example.com"],
  "latestEvalPassRate": {
    "passRate": 0.0,
    "caseCount": 0,
    "passedCount": 0,
    "failedCount": 0,
    "project": "tinker-ask",
    "at": "2026-01-01T00:00:00.000Z",
    "experimentUrl": ""
  },
  "usersPerMonth": [{ "month": "2026-10", "users": 0 }],
  "usersLast30Days": 0,
  "generatedAt": "2026-01-01T00:00:00.000Z"
}
```

Auth: `Authorization: Bearer <TINKER_SERVICE_TOKEN>`,
`X-Tinker-Service-Token`, or an owner Stytch session.

Related writes:

- `POST /api/metrics?action=record_eval` — body includes `passRate`,
  `caseCount`, optional `passedCount` / `failedCount` / `experimentUrl` /
  `project` / `report`.
- `POST /api/metrics?action=sdk_loaded` — body `{ host, anonymousId? }`
  (optional beacon when the embed script cannot create a session yet).

## Implementation pointers

| Concern | Path |
| --- | --- |
| Event name contract | `src/renderer/lib/metrics/events.js` |
| Browser `track()` + owner `beforeSend` | `src/renderer/lib/metrics/client-track.js` |
| Server `track()` | `api/_lib/metrics/emit.js` |
| Prisma queries + embed/eval writes | `api/_lib/metrics/resume.js` |
| HTTP API | `api/metrics.js` |
| Session / ask / click emit | `api/reading.js` |
| CI drift + emission guard | `tests/resume-metrics.test.js` |
