# Local Codex exercise feedback

The updated desktop shell uses Codex when an exercise's feedback essay is finished. Browsers and older shells retain server-side Claude. Codex failures never fall back to Claude.

## Setup

1. Install/update the official CLI: `npm install -g @openai/codex`. Use the latest release and restart Tinker after installing/updating it. Config-isolation flags were introduced in 0.122.0; older CLIs fail closed.
2. Install a rebuilt desktop shell containing this change. Deploy the matching web/API changes before using it. This PR does not deploy either part.
3. Finish the feedback essay. If sign-in is missing, choose **Codex setup** beside the exercise's **Retry** button, then **Copy sign-in command**.
4. Run that command in Terminal (PowerShell on Windows), complete ChatGPT sign-in yourself, then return and Retry.

The command targets a dedicated `codex-exercise-home` under Electron's user-data directory. Signing into the ordinary Codex app alone does not sign into this folder. Tinker never imports personal CLI credentials or reads authentication files. API-key authentication is rejected and API-key environment variables are not inherited. Eligible ChatGPT plan Codex allowance and limits apply; this is not unlimited usage or project API-key billing.

Do not add custom configuration, hooks, skills, plugins, or rules to this folder. On macOS, standard Homebrew locations and absolute PATH entries are searched. Nonstandard installations must be available to the desktop process.

## Safeguards

- Tinker's API authenticates the owner and supplies exact exercise context plus an exercise/essay fingerprint.
- Only the first-party top-level desktop window can invoke Codex. Credentials and raw subprocess output never cross IPC or reach the server.
- Codex gets a temporary directory, read-only sandbox, disabled tools/search/hooks/apps, isolated configuration, bounded time/output, and JSON schema. Codex sends the selected essay and exercise content to OpenAI.
- Input: at most 40 files, 14,000 characters per file, 12,000 essay characters, 400KB serialized context. Oversized context is rejected, never truncated. Output: at most 24 changed files, validated again by the API.
- Cancel stops generation and prevents applying its result. Navigation/window close cancels the process. Once saving starts, Cancel cannot roll it back.
- Only the owner's selected exercise can change. Stale fingerprints or racing writes return a conflict. Unrelated exercises are preserved. GitHub and local exercise repositories are not modified.
- Starter files stay incomplete; review generated changes. Fixture revisions are unsupported.

## Release verification

Mocked subprocess/persistence tests make no live model calls and read no credentials. Before release, test the packaged desktop with a user-completed sign-in: initial setup, successful revision, cancel/navigation, expired sign-in, exhausted usage, and stale-edit conflicts. No live authenticated or packaged-desktop test has been performed in this change.

Official references:
- https://developers.openai.com/codex/noninteractive
- https://developers.openai.com/codex/cli/reference
- https://developers.openai.com/codex/config-reference
- https://github.com/openai/codex/releases/tag/rust-v0.122.0
