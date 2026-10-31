# DO NOT PUBLISH — Resume v144 goals (locked map)

Internal target map only. Not for README, PR bodies, marketing pages,
dashboards, or any public surface. Goal numbers live only in files named
`DO_NOT_PUBLISH*`. Definitions of how to measure each line live in
`RESUME_METRICS.md` (no targets there).

Locked: resume **v144** (product build start: Oct 30, 2026, 9:19 PM PT).

| Line | Goal |
| --- | --- |
| Users (30-day) | **50** users in 30 days (`usersLast30Days` / resume users active in trailing 30 days) |
| Questions | **300+** questions (`questions`) |
| SDK embed hosts | Embedded on **3** sites (`embedHosts` length; excludes lindowlabs.dev, localhost, Vercel previews, first-party Tinker hosts) |
| Eval gate — CasePass | **0.90+** |
| Eval gate — safety | **0.95+** |

Do not commit achieved results or progress snapshots into this repo as
published facts. Read live numbers from Production `GET /api/metrics`
(owner excluded) and Braintrust / `EvalRun`.
