/* notes-files.js — local-first note files on this device (TYL-49).
 *
 * Each note is one Markdown file with a small frontmatter block:
 *
 *   ---
 *   id: n_…
 *   title: …
 *   createdAt: <ms>
 *   updatedAt: <ms>
 *   syncState: local
 *   ---
 *
 *   body text
 *
 * Storage preference:
 *   1. Origin Private File System (real files under notes/)
 *   2. localStorage map keyed by note id (same file text)
 *
 * Notes stay on the device. Nothing here phones home. The content
 * store can later take noteId when a note is published as site copy.
 *
 * Dual export: window.tinkerNotesFiles in the browser; module.exports
 * for node tests (serialize / parse / memory backend).
 */

(function (root) {
  "use strict";

  var DIR_NAME = "notes";
  var LS_FILES_KEY = "tinker.notes.files.v1";
  var MAX_BODY = 100000;
  var MAX_TITLE = 300;

  function noteId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return "n_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    }
    return "n_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function titleFromBody(body) {
    var line = String(body || "")
      .split(/\r?\n/)
      .map(function (s) { return s.trim(); })
      .find(function (s) { return s.length > 0; });
    if (!line) return "Untitled";
    if (line.length > MAX_TITLE) return line.slice(0, MAX_TITLE);
    return line;
  }

  function clampBody(body) {
    var text = typeof body === "string" ? body : "";
    if (text.length > MAX_BODY) return text.slice(0, MAX_BODY);
    return text;
  }

  function escapeFrontmatter(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "");
  }

  function unescapeFrontmatter(value) {
    return String(value || "")
      .replace(/\\n/g, "\n")
      .replace(/\\\\/g, "\\");
  }

  function serializeNote(note) {
    var id = typeof note.id === "string" && note.id.trim() ? note.id.trim() : noteId();
    var body = clampBody(note.body);
    var title =
      typeof note.title === "string" && note.title.trim()
        ? note.title.trim().slice(0, MAX_TITLE)
        : titleFromBody(body);
    var createdAt = Number(note.createdAt) || Date.now();
    var updatedAt = Number(note.updatedAt) || createdAt;
    var syncState =
      typeof note.syncState === "string" && note.syncState.trim()
        ? note.syncState.trim()
        : "local";
    var head = [
      "---",
      "id: " + escapeFrontmatter(id),
      "title: " + escapeFrontmatter(title),
      "createdAt: " + String(createdAt),
      "updatedAt: " + String(updatedAt),
      "syncState: " + escapeFrontmatter(syncState),
      "---",
      "",
      body,
    ].join("\n");
    return head;
  }

  function parseNoteFile(text) {
    var raw = typeof text === "string" ? text : "";
    var match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
      var now = Date.now();
      var body = clampBody(raw);
      return {
        id: noteId(),
        title: titleFromBody(body),
        body: body,
        createdAt: now,
        updatedAt: now,
        syncState: "local",
      };
    }
    var meta = {};
    match[1].split(/\r?\n/).forEach(function (line) {
      var idx = line.indexOf(":");
      if (idx === -1) return;
      var key = line.slice(0, idx).trim();
      var value = unescapeFrontmatter(line.slice(idx + 1).trim());
      meta[key] = value;
    });
    var body = clampBody(String(match[2] || "").replace(/^\r?\n/, ""));
    var createdAt = Number(meta.createdAt) || Date.now();
    var updatedAt = Number(meta.updatedAt) || createdAt;
    var id =
      typeof meta.id === "string" && meta.id.trim()
        ? meta.id.trim()
        : noteId();
    var title =
      typeof meta.title === "string" && meta.title.trim()
        ? meta.title.trim().slice(0, MAX_TITLE)
        : titleFromBody(body);
    return {
      id: id,
      title: title,
      body: body,
      createdAt: createdAt,
      updatedAt: updatedAt,
      syncState:
        typeof meta.syncState === "string" && meta.syncState.trim()
          ? meta.syncState.trim()
          : "local",
    };
  }

  function summarize(note) {
    return {
      id: note.id,
      title: note.title,
      updatedAt: note.updatedAt,
      createdAt: note.createdAt,
      syncState: note.syncState,
      preview: String(note.body || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120),
    };
  }

  function readLsMap() {
    try {
      var raw = localStorage.getItem(LS_FILES_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeLsMap(map) {
    try {
      localStorage.setItem(LS_FILES_KEY, JSON.stringify(map));
    } catch (e) {
      /* quota */
    }
  }

  function createMemoryBackend(seed) {
    var files = Object.create(null);
    if (seed && typeof seed === "object") {
      Object.keys(seed).forEach(function (id) {
        files[id] = String(seed[id]);
      });
    }
    return {
      kind: "memory",
      listIds: function () {
        return Promise.resolve(Object.keys(files));
      },
      read: function (id) {
        return Promise.resolve(
          Object.prototype.hasOwnProperty.call(files, id) ? files[id] : null,
        );
      },
      write: function (id, text) {
        files[id] = String(text);
        return Promise.resolve();
      },
      remove: function (id) {
        delete files[id];
        return Promise.resolve();
      },
      _dump: function () {
        return Object.assign({}, files);
      },
    };
  }

  function createLocalStorageBackend() {
    return {
      kind: "localStorage",
      listIds: function () {
        return Promise.resolve(Object.keys(readLsMap()));
      },
      read: function (id) {
        var map = readLsMap();
        return Promise.resolve(
          Object.prototype.hasOwnProperty.call(map, id) ? map[id] : null,
        );
      },
      write: function (id, text) {
        var map = readLsMap();
        map[id] = String(text);
        writeLsMap(map);
        return Promise.resolve();
      },
      remove: function (id) {
        var map = readLsMap();
        delete map[id];
        writeLsMap(map);
        return Promise.resolve();
      },
    };
  }

  function createOpfsBackend(root) {
    return {
      kind: "opfs",
      listIds: async function () {
        var ids = [];
        for await (var entry of root.values()) {
          if (entry.kind !== "file") continue;
          var name = entry.name || "";
          if (!name.endsWith(".md")) continue;
          ids.push(name.slice(0, -3));
        }
        return ids;
      },
      read: async function (id) {
        try {
          var handle = await root.getFileHandle(id + ".md");
          var file = await handle.getFile();
          return await file.text();
        } catch (e) {
          return null;
        }
      },
      write: async function (id, text) {
        var handle = await root.getFileHandle(id + ".md", { create: true });
        var writable = await handle.createWritable();
        await writable.write(String(text));
        await writable.close();
      },
      remove: async function (id) {
        try {
          await root.removeEntry(id + ".md");
        } catch (e) {
          /* missing is fine */
        }
      },
    };
  }

  async function pickBackend() {
    if (
      typeof navigator !== "undefined" &&
      navigator.storage &&
      typeof navigator.storage.getDirectory === "function"
    ) {
      try {
        var root = await navigator.storage.getDirectory();
        var notesDir = await root.getDirectoryHandle(DIR_NAME, { create: true });
        var opfs = createOpfsBackend(notesDir);
        // Migrate any localStorage leftovers into OPFS once.
        var legacy = readLsMap();
        var legacyIds = Object.keys(legacy);
        if (legacyIds.length) {
          for (var i = 0; i < legacyIds.length; i++) {
            var id = legacyIds[i];
            var existing = await opfs.read(id);
            if (existing == null) await opfs.write(id, legacy[id]);
          }
          try {
            localStorage.removeItem(LS_FILES_KEY);
          } catch (e) {
            /* ignore */
          }
        }
        return opfs;
      } catch (e) {
        /* fall through */
      }
    }
    if (typeof localStorage !== "undefined") {
      return createLocalStorageBackend();
    }
    return createMemoryBackend();
  }

  function createStore(backendPromise) {
    var ready = Promise.resolve(backendPromise).then(function (b) {
      return b || createMemoryBackend();
    });

    async function withBackend(fn) {
      var backend = await ready;
      return fn(backend);
    }

    return {
      ready: ready.then(function (b) {
        return b.kind;
      }),
      list: function () {
        return withBackend(async function (backend) {
          var ids = await backend.listIds();
          var notes = [];
          for (var i = 0; i < ids.length; i++) {
            var text = await backend.read(ids[i]);
            if (text == null) continue;
            notes.push(summarize(parseNoteFile(text)));
          }
          notes.sort(function (a, b) {
            return (b.updatedAt || 0) - (a.updatedAt || 0);
          });
          return notes;
        });
      },
      get: function (id) {
        return withBackend(async function (backend) {
          if (typeof id !== "string" || !id.trim()) return null;
          var text = await backend.read(id.trim());
          if (text == null) return null;
          return parseNoteFile(text);
        });
      },
      create: function (seed) {
        return withBackend(async function (backend) {
          var now = Date.now();
          var body = clampBody(seed && seed.body);
          var note = {
            id: noteId(),
            title:
              seed && typeof seed.title === "string" && seed.title.trim()
                ? seed.title.trim().slice(0, MAX_TITLE)
                : titleFromBody(body),
            body: body,
            createdAt: now,
            updatedAt: now,
            syncState: "local",
          };
          await backend.write(note.id, serializeNote(note));
          return note;
        });
      },
      save: function (note) {
        return withBackend(async function (backend) {
          if (!note || typeof note.id !== "string" || !note.id.trim()) {
            throw new Error("note id is required");
          }
          var existingText = await backend.read(note.id.trim());
          var existing = existingText == null ? null : parseNoteFile(existingText);
          var next = {
            id: note.id.trim(),
            title:
              typeof note.title === "string" && note.title.trim()
                ? note.title.trim().slice(0, MAX_TITLE)
                : titleFromBody(note.body),
            body: clampBody(note.body),
            createdAt: existing ? existing.createdAt : Number(note.createdAt) || Date.now(),
            updatedAt: Date.now(),
            syncState:
              typeof note.syncState === "string" && note.syncState.trim()
                ? note.syncState.trim()
                : existing
                  ? existing.syncState
                  : "local",
          };
          await backend.write(next.id, serializeNote(next));
          return next;
        });
      },
      remove: function (id) {
        return withBackend(async function (backend) {
          if (typeof id !== "string" || !id.trim()) return false;
          await backend.remove(id.trim());
          return true;
        });
      },
    };
  }

  var api = {
    DIR_NAME: DIR_NAME,
    LS_FILES_KEY: LS_FILES_KEY,
    noteId: noteId,
    titleFromBody: titleFromBody,
    serializeNote: serializeNote,
    parseNoteFile: parseNoteFile,
    summarize: summarize,
    createMemoryBackend: createMemoryBackend,
    createLocalStorageBackend: createLocalStorageBackend,
    createStore: createStore,
    openDefaultStore: function () {
      return createStore(pickBackend());
    },
  };

  var defaultStore = null;
  function ensureDefault() {
    if (!defaultStore) defaultStore = api.openDefaultStore();
    return defaultStore;
  }

  api.list = function () {
    return ensureDefault().list();
  };
  api.get = function (id) {
    return ensureDefault().get(id);
  };
  api.create = function (seed) {
    return ensureDefault().create(seed);
  };
  api.save = function (note) {
    return ensureDefault().save(note);
  };
  api.remove = function (id) {
    return ensureDefault().remove(id);
  };
  api.ready = function () {
    return ensureDefault().ready;
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.tinkerNotesFiles = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
