/* Thin GitHub REST client for the developer sign-in flow.
 *
 * The only call we make is "list the signed-in user's repositories" so
 * the repo picker on the auth gate can show what tinker may be given
 * access to. The access token comes from Stytch's OAuth provider_values
 * and lives server-side in the user's TinkerUserData row — it is never
 * shipped to the browser.
 */

"use strict";

const API_BASE = "https://api.github.com";

async function ghGet(path, accessToken) {
  const res = await fetch(API_BASE + path, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      // GitHub rejects requests without a User-Agent.
      "User-Agent": "tinker-web",
    },
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const message = (payload && payload.message) || `GitHub ${res.status}`;
    // A 401 means the stored token was revoked or expired — surface it
    // as 409 so the client can prompt a reconnect instead of treating
    // it like a dead tinker session.
    const status = res.status === 401 ? 409 : 502;
    throw Object.assign(new Error(message), { status });
  }

  return payload;
}

// List repos the user can access, newest activity first. Paged at 100;
// capped at 3 pages — a picker with 300 rows is already past useful,
// and the client filters by name anyway.
async function listRepos(accessToken) {
  const all = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await ghGet(
      `/user/repos?per_page=100&page=${page}&sort=updated` +
        `&affiliation=owner,collaborator,organization_member`,
      accessToken,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    private: Boolean(r.private),
    description: r.description || "",
    updatedAt: r.updated_at || null,
  }));
}

module.exports = { listRepos };
