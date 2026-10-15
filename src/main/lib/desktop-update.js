/**
 * Desktop shell update check.
 *
 * Fetches the latest GitHub release for beginner-work/tinker and surfaces a
 * download only when the release notes' first line is exactly
 * "Download needed" and the release version is newer than the installed app.
 *
 * Companion first line (no UI): "No download needed, updates on next launch".
 */
"use strict";

const RELEASES_LATEST_URL =
  "https://api.github.com/repos/beginner-work/tinker/releases/latest";

const DOWNLOAD_NEEDED_LINE = "Download needed";
const NO_DOWNLOAD_NEEDED_LINE = "No download needed, updates on next launch";

function releaseNotesFirstLine(body) {
  if (typeof body !== "string" || !body) return "";
  const line = body.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0];
  return String(line || "").trim();
}

function isDownloadNeededRelease(body) {
  return releaseNotesFirstLine(body) === DOWNLOAD_NEEDED_LINE;
}

function parseSemver(version) {
  const m = String(version || "")
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isNewerVersion(latest, current) {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function pickDownloadUrl(release, platform) {
  const assets = Array.isArray(release && release.assets) ? release.assets : [];
  const list = assets
    .map((a) => ({
      name: typeof a.name === "string" ? a.name : "",
      url: typeof a.browser_download_url === "string" ? a.browser_download_url : "",
    }))
    .filter((a) => a.name && a.url);

  let pick = null;
  if (platform === "darwin") {
    pick =
      list.find((a) => a.name === "tinker-mac.dmg") ||
      list.find((a) => /\.dmg$/i.test(a.name));
  } else if (platform === "win32") {
    pick =
      list.find((a) => /^tinker-[\d.]+-x64\.exe$/i.test(a.name)) ||
      list.find((a) => /\.exe$/i.test(a.name) && !/portable/i.test(a.name)) ||
      list.find((a) => /\.exe$/i.test(a.name));
  } else {
    pick =
      list.find((a) => /\.AppImage$/i.test(a.name)) ||
      list.find((a) => /\.tar\.gz$/i.test(a.name));
  }

  if (pick) return pick.url;
  if (release && typeof release.html_url === "string" && release.html_url) {
    return release.html_url;
  }
  const tag = release && release.tag_name ? String(release.tag_name) : "latest";
  return `https://github.com/beginner-work/tinker/releases/tag/${encodeURIComponent(tag)}`;
}

async function fetchLatestRelease(fetchImpl) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== "function") return null;
  try {
    const res = await fetchFn(RELEASES_LATEST_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "tinker-desktop",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res || !res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== "object") return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<null | { version: string, downloadUrl: string, htmlUrl: string }>}
 */
async function checkDesktopUpdate({
  currentVersion,
  platform,
  fetchImpl,
} = {}) {
  const release = await fetchLatestRelease(fetchImpl);
  if (!release) return null;
  if (!isDownloadNeededRelease(release.body)) return null;

  const version = String(release.tag_name || "")
    .trim()
    .replace(/^v/i, "");
  if (!version || !isNewerVersion(version, currentVersion)) return null;

  return {
    version,
    downloadUrl: pickDownloadUrl(release, platform || process.platform),
    htmlUrl:
      typeof release.html_url === "string" && release.html_url
        ? release.html_url
        : `https://github.com/beginner-work/tinker/releases/tag/v${version}`,
  };
}

module.exports = {
  DOWNLOAD_NEEDED_LINE,
  NO_DOWNLOAD_NEEDED_LINE,
  RELEASES_LATEST_URL,
  releaseNotesFirstLine,
  isDownloadNeededRelease,
  parseSemver,
  isNewerVersion,
  pickDownloadUrl,
  fetchLatestRelease,
  checkDesktopUpdate,
};
