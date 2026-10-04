/* Detect Mac cloud storage roots: iCloud Drive, Google Drive for desktop,
 * and other ~/Library/CloudStorage/* File Provider folders (Dropbox,
 * OneDrive, …). Pure FS helpers; pass a fake home + fs stubs in tests.
 * Missing installs return installed:false and never throw.
 */
"use strict";

const path = require("path");
const fs = require("fs");

const ICLOUD_REL = path.join("Library", "Mobile Documents", "com~apple~CloudDocs");
const CLOUD_STORAGE_REL = path.join("Library", "CloudStorage");
const TINKER_DIR = "Tinker";

function defaultFs() {
  return {
    existsSync: fs.existsSync.bind(fs),
    readdirSync: fs.readdirSync.bind(fs),
    statSync: fs.statSync.bind(fs),
    mkdirSync: fs.mkdirSync.bind(fs),
  };
}

function isDir(fsApi, target) {
  try {
    if (!fsApi.existsSync(target)) return false;
    return fsApi.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function listNames(fsApi, dir) {
  try {
    const entries = fsApi.readdirSync(dir);
    return (entries || []).map((entry) => {
      if (entry == null) return "";
      if (typeof entry === "string") return entry;
      return entry.name != null ? String(entry.name) : "";
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function parseGoogleDriveAccount(folderName) {
  const raw = String(folderName || "");
  if (!raw.startsWith("GoogleDrive-")) return "";
  return raw.slice("GoogleDrive-".length).trim();
}

function resolveMyDrive(fsApi, accountRoot) {
  const preferred = path.join(accountRoot, "My Drive");
  if (isDir(fsApi, preferred)) return preferred;
  // Localized "My Drive" fallback: first child directory.
  const names = listNames(fsApi, accountRoot);
  for (const name of names) {
    if (String(name).startsWith(".")) continue;
    const child = path.join(accountRoot, name);
    if (isDir(fsApi, child)) return child;
  }
  return "";
}

/** Dropbox / OneDrive / other File Provider folder -> { id, label, provider }. */
function labelCloudStorageFolder(folderName) {
  const raw = String(folderName || "").trim();
  if (!raw) return null;
  if (raw.startsWith("GoogleDrive-")) return null; // handled separately

  const dash = raw.indexOf("-");
  let provider = raw;
  let detail = "";
  if (dash > 0) {
    provider = raw.slice(0, dash);
    detail = raw.slice(dash + 1).trim();
  }

  const providerKey = provider.toLowerCase();
  let label;
  if (providerKey === "dropbox") {
    label = detail ? "Dropbox (" + detail + ")" : "Dropbox";
  } else if (providerKey === "onedrive") {
    label = detail ? "OneDrive (" + detail + ")" : "OneDrive";
  } else {
    label = detail ? provider + " (" + detail + ")" : provider;
  }

  return {
    id: "cloud:" + raw,
    label,
    provider: providerKey || "cloud",
    account: detail,
  };
}

/**
 * @returns {Array<{id:string,label:string,path:string,installed:boolean,account?:string,provider?:string}>}
 */
function detectCloudRoots(opts) {
  const options = opts || {};
  const platform = options.platform || process.platform;
  const homeDir = options.homeDir || process.env.HOME || "";
  const fsApi = options.fs || defaultFs();

  const icloudPath = homeDir ? path.join(homeDir, ICLOUD_REL) : "";
  const icloudInstalled = platform === "darwin" && !!icloudPath && isDir(fsApi, icloudPath);
  const roots = [
    {
      id: "icloud",
      label: "iCloud Drive",
      path: icloudInstalled ? icloudPath : "",
      installed: icloudInstalled,
      provider: "icloud",
    },
  ];

  if (platform !== "darwin" || !homeDir) {
    roots.push({
      id: "google-drive",
      label: "Google Drive",
      path: "",
      installed: false,
      account: "",
      provider: "google-drive",
    });
    return roots;
  }

  const cloudStorage = path.join(homeDir, CLOUD_STORAGE_REL);
  const googleEntries = [];
  const otherEntries = [];

  if (isDir(fsApi, cloudStorage)) {
    for (const name of listNames(fsApi, cloudStorage)) {
      if (String(name).startsWith(".")) continue;
      const accountRoot = path.join(cloudStorage, name);
      if (!isDir(fsApi, accountRoot)) continue;

      const googleAccount = parseGoogleDriveAccount(name);
      if (googleAccount) {
        const myDrive = resolveMyDrive(fsApi, accountRoot);
        if (!myDrive) continue;
        googleEntries.push({
          id: "google-drive:" + googleAccount,
          label: "Google Drive (" + googleAccount + ")",
          path: myDrive,
          installed: true,
          account: googleAccount,
          provider: "google-drive",
        });
        continue;
      }

      const meta = labelCloudStorageFolder(name);
      if (!meta) continue;
      otherEntries.push({
        id: meta.id,
        label: meta.label,
        path: accountRoot,
        installed: true,
        account: meta.account || "",
        provider: meta.provider,
      });
    }
  }

  if (googleEntries.length === 0) {
    roots.push({
      id: "google-drive",
      label: "Google Drive",
      path: "",
      installed: false,
      account: "",
      provider: "google-drive",
    });
  } else {
    roots.push.apply(roots, googleEntries);
  }
  roots.push.apply(roots, otherEntries);
  return roots;
}

function matchRoot(roots, id) {
  const want = String(id || "");
  if (!want) return null;
  const exact = roots.find((row) => row.id === want);
  if (exact) return exact;
  if (want === "google-drive") {
    return roots.find((row) => String(row.id).startsWith("google-drive") && row.installed) || null;
  }
  return null;
}

/**
 * Create <root>/Tinker and return { path, name } like notesFolder:pick.
 * @returns {{path:string,name:string,id:string,label:string}|null}
 */
function useCloudRoot(id, opts) {
  const options = opts || {};
  const fsApi = options.fs || defaultFs();
  const roots = detectCloudRoots(options);
  const match = matchRoot(roots, id);
  if (!match || !match.installed || !match.path) return null;
  const target = path.join(match.path, TINKER_DIR);
  fsApi.mkdirSync(target, { recursive: true });
  return {
    path: target,
    name: TINKER_DIR,
    id: match.id,
    label: match.label,
  };
}

module.exports = {
  ICLOUD_REL,
  CLOUD_STORAGE_REL,
  TINKER_DIR,
  detectCloudRoots,
  useCloudRoot,
  parseGoogleDriveAccount,
  resolveMyDrive,
  labelCloudStorageFolder,
  matchRoot,
};
