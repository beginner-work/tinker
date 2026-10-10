/* exercise-revision.js - revise exercise README / steps / starter from an essay.
 *
 * When the owner finishes an essay tagged to an exercise ("This is everything"),
 * Claude (server) rewrites the exercise's README, Start here steps, and starter
 * stubs. The client also keeps a local step-list fallback for demos / offline.
 *
 * Persists by updating file content inside the existing exercise workspace
 * model (TinkerUserData). GitHub / tlindow/lindowlabs is not written — Tinker
 * has no commit/push path for that repo (desktop only clones/pulls for IDE).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerExerciseRevision = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var PRACTICE_NAME_RE = /^(read|write|practice|untitled|stub)/i;
  var CODE_EXT_RE = /\.(js|ts|tsx|jsx|mjs|cjs|py|go|rs|java|rb)$/i;
  var SKIP_NAME_RE = /^(package\.json|\.gitignore|.*\.lock|.*\.test\..*|.*\.spec\..*)$/i;
  var FIXTURE_RE = /(^|\/)(fixtures?|__fixtures__|testdata)(\/|$)/i;

  function extractStepsFromEssay(body) {
    var text = String(body == null ? "" : body);
    var lines = text.split(/\r?\n/);
    var steps = [];
    var i;
    for (i = 0; i < lines.length; i += 1) {
      var line = lines[i].replace(/^\s+|\s+$/g, "");
      if (!line) continue;
      var m = line.match(/^(?:#{1,6}\s*)?(?:[-*+]|\d+[.)])\s+(.+)$/);
      if (m && m[1]) {
        var step = String(m[1]).replace(/\s+/g, " ").trim();
        if (step.length >= 3) steps.push(step);
        continue;
      }
      // Bare instructional sentences that look like step goals.
      if (/^(split|merge|change|add|remove|rewrite|make|update|break|combine)\b/i.test(line) && line.length <= 200) {
        steps.push(line);
      }
    }
    // Deduplicate while preserving order.
    var seen = Object.create(null);
    var out = [];
    steps.forEach(function (s) {
      var key = s.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push(s);
    });
    return out;
  }

  function findReadmeNode(nodes) {
    var list = Array.isArray(nodes) ? nodes : [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i] && list[i].type === "file" && String(list[i].name).toLowerCase() === "readme.md") {
        return list[i];
      }
    }
    return null;
  }

  function formatStepsSection(steps) {
    var lines = ["## Start here", "", "> Updated from your essay.", ""];
    (steps || []).forEach(function (step, idx) {
      lines.push((idx + 1) + ". " + step);
    });
    lines.push("");
    return lines.join("\n");
  }

  function extractStepsFromReadme(content) {
    var src = String(content == null ? "" : content);
    var section = src.match(/##\s*Start here\s*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i);
    var block = section ? section[1] : src;
    return extractStepsFromEssay(block);
  }

  function reviseReadmeContent(existing, steps) {
    var src = String(existing == null ? "" : existing);
    var section = formatStepsSection(steps);
    if (!steps || !steps.length) return src;

    // Replace an existing "## Start here" section through the next heading or EOF.
    var replaced = src.replace(
      /(^|\n)##\s*Start here\s*\n[\s\S]*?(?=\n##\s|\n#\s|$)/i,
      function (match, lead) {
        return lead + section.replace(/\n$/, "") + "\n";
      }
    );
    if (replaced !== src) return replaced;

    // Or replace a numbered list under a trailing heading-less block.
    if (/\n1\.\s+/.test(src)) {
      var withList = src.replace(
        /\n1\.\s+[\s\S]*$/m,
        "\n" + section
      );
      if (withList !== src) return withList;
    }

    // Append.
    var trim = src.replace(/\s+$/, "");
    return (trim ? trim + "\n\n" : "") + section;
  }

  function isPracticeFile(node) {
    if (!node || node.type !== "file") return false;
    var name = String(node.name || "");
    if (/^readme\.md$/i.test(name)) return false;
    if (PRACTICE_NAME_RE.test(name)) return true;
    if (CODE_EXT_RE.test(name) && !/\.test\./i.test(name) && name.toLowerCase() !== "package.json") {
      return true;
    }
    return false;
  }

  function nodeRelPath(nodes, nodeId) {
    var list = Array.isArray(nodes) ? nodes : [];
    var byId = Object.create(null);
    list.forEach(function (n) {
      if (n && n.id) byId[n.id] = n;
    });
    var parts = [];
    var cur = byId[String(nodeId || "")];
    var guard = 0;
    while (cur && guard < 64) {
      parts.unshift(String(cur.name || ""));
      if (!cur.parentId) break;
      cur = byId[cur.parentId];
      guard += 1;
    }
    return parts.filter(Boolean).join("/");
  }

  function findNodeByPath(nodes, relPath) {
    var want = String(relPath || "").replace(/^\/+|\/+$/g, "");
    if (!want) return null;
    var list = Array.isArray(nodes) ? nodes : [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].type !== "file") continue;
      if (nodeRelPath(list, list[i].id) === want) return list[i];
    }
    return null;
  }

  function listExerciseFiles(nodes, opts) {
    opts = opts || {};
    var maxFiles = opts.maxFiles != null ? opts.maxFiles : 24;
    var maxChars = opts.maxChars != null ? opts.maxChars : 14000;
    var list = Array.isArray(nodes) ? nodes : [];
    var out = [];
    list.forEach(function (n) {
      if (!n || n.type !== "file") return;
      var path = nodeRelPath(list, n.id);
      if (!path) return;
      if (FIXTURE_RE.test(path) && opts.includeFixtures !== true) return;
      if (SKIP_NAME_RE.test(n.name) && !/^readme\.md$/i.test(n.name)) return;
      var content = String(n.content == null ? "" : n.content);
      if (content.length > maxChars) {
        content = content.slice(0, maxChars) + "\n/* …truncated… */\n";
      }
      out.push({ path: path, content: content, nodeId: n.id });
    });
    // Prefer README + starter stubs first.
    out.sort(function (a, b) {
      var ar = /^readme\.md$/i.test(a.path) ? 0 : (isPracticeFile({ type: "file", name: a.path.split("/").pop() }) ? 1 : 2);
      var br = /^readme\.md$/i.test(b.path) ? 0 : (isPracticeFile({ type: "file", name: b.path.split("/").pop() }) ? 1 : 2);
      if (ar !== br) return ar - br;
      return a.path < b.path ? -1 : 1;
    });
    return out.slice(0, maxFiles);
  }

  function ensureFolderPath(state, core, exerciseId, folderPath) {
    var parts = String(folderPath || "").split("/").filter(Boolean);
    if (!parts.length) return null;
    var ex = state.exercises[exerciseId];
    var parentId = null;
    var built = "";
    parts.forEach(function (part) {
      built = built ? built + "/" + part : part;
      var existing = null;
      var nodes = ex.nodes;
      for (var i = 0; i < nodes.length; i += 1) {
        if (nodes[i].type === "folder" && nodeRelPath(nodes, nodes[i].id) === built) {
          existing = nodes[i];
          break;
        }
      }
      if (existing) {
        parentId = existing.id;
        return;
      }
      var created = core.createNode(state, {
        exerciseId: exerciseId,
        type: "folder",
        name: part,
        parentId: parentId,
      });
      state = core.normalizeWorkspace(created.workspace);
      ex = state.exercises[exerciseId];
      parentId = created.node.id;
    });
    return { workspace: state, parentId: parentId };
  }

  function writePathContent(state, core, exerciseId, relPath, content) {
    var path = String(relPath || "").replace(/^\/+|\/+$/g, "");
    if (!path || path.indexOf("..") !== -1) {
      throw Object.assign(new Error("Invalid file path."), { status: 400 });
    }
    var parts = path.split("/");
    var fileName = parts[parts.length - 1];
    var folderPath = parts.slice(0, -1).join("/");
    var parentId = null;
    if (folderPath) {
      var ensured = ensureFolderPath(state, core, exerciseId, folderPath);
      state = ensured.workspace;
      parentId = ensured.parentId;
    }
    var ex = state.exercises[exerciseId];
    var existing = findNodeByPath(ex.nodes, path);
    if (existing) {
      var written = core.writeFile(state, {
        exerciseId: exerciseId,
        nodeId: existing.id,
        content: content == null ? "" : String(content),
      });
      return {
        workspace: core.normalizeWorkspace(written.workspace),
        nodeId: existing.id,
        created: false,
      };
    }
    var created = core.createNode(state, {
      exerciseId: exerciseId,
      type: "file",
      name: fileName,
      parentId: parentId,
      content: content == null ? "" : String(content),
    });
    return {
      workspace: core.normalizeWorkspace(created.workspace),
      nodeId: created.node.id,
      created: true,
    };
  }

  /**
   * Apply Claude (or local) file patches onto an exercise.
   * Updates README / starter stubs. Returns { workspace, steps, filesUpdated, readmeNodeId, changed }.
   */
  function applyClaudeRevision(workspace, opts) {
    opts = opts || {};
    var core = opts.core;
    if (!core) throw new Error("exercise core required");
    var exerciseId = String(opts.exerciseId || "").trim();
    if (!exerciseId) throw new Error("exerciseId is required");

    var state = core.normalizeWorkspace(workspace);
    var ex = state.exercises[exerciseId];
    if (!ex) throw Object.assign(new Error("Exercise not found."), { status: 404 });

    var steps = Array.isArray(opts.steps) ? opts.steps.map(function (s) {
      return String(s || "").replace(/\s+/g, " ").trim();
    }).filter(Boolean) : [];
    if (!steps.length && opts.essayBody) {
      steps = extractStepsFromEssay(opts.essayBody);
    }

    var files = Array.isArray(opts.files) ? opts.files : [];
    var filesUpdated = [];
    var readmeNodeId = null;
    var i;

    // Ensure README exists before patches so step rewrite has a home.
    var readme = findReadmeNode(ex.nodes);
    if (!readme) {
      var createdReadme = core.createNode(state, {
        exerciseId: exerciseId,
        type: "file",
        name: "README.md",
        parentId: null,
        content: "# " + (ex.name || exerciseId) + "\n\n",
      });
      state = core.normalizeWorkspace(createdReadme.workspace);
      ex = state.exercises[exerciseId];
      readme = findReadmeNode(ex.nodes);
    }
    readmeNodeId = readme ? readme.id : null;

    for (i = 0; i < files.length; i += 1) {
      var row = files[i];
      if (!row || !row.path) continue;
      var path = String(row.path).replace(/^\/+|\/+$/g, "");
      if (!path || FIXTURE_RE.test(path)) continue;
      var content = row.content == null ? "" : String(row.content);
      // If Claude sent README without a Start here but we have steps, inject them.
      if (/^readme\.md$/i.test(path) && steps.length && !/##\s*Start here/i.test(content)) {
        content = reviseReadmeContent(content, steps);
      } else if (/^readme\.md$/i.test(path) && steps.length) {
        content = reviseReadmeContent(content, steps);
      }
      var written = writePathContent(state, core, exerciseId, path, content);
      state = written.workspace;
      filesUpdated.push({ path: path, nodeId: written.nodeId, created: written.created });
      if (/^readme\.md$/i.test(path)) readmeNodeId = written.nodeId;
    }

    // No file patches: fall back to README step rewrite only.
    if (!filesUpdated.length) {
      if (!steps.length && opts.essayBody) {
        var first = String(opts.essayBody).split(/\r?\n/).map(function (l) {
          return l.trim();
        }).filter(Boolean)[0];
        if (first) steps = ["Revise the exercise to match: " + first.slice(0, 160)];
      }
      if (!steps.length) {
        return {
          workspace: core.presentWorkspace(state),
          readmeNodeId: readmeNodeId,
          steps: [],
          filesUpdated: [],
          changed: false,
        };
      }
      ex = state.exercises[exerciseId];
      readme = findReadmeNode(ex.nodes);
      var nextContent = reviseReadmeContent(readme.content || "", steps);
      var onlyReadme = core.writeFile(state, {
        exerciseId: exerciseId,
        nodeId: readme.id,
        content: nextContent,
      });
      state = core.normalizeWorkspace(onlyReadme.workspace);
      readmeNodeId = readme.id;
      filesUpdated.push({ path: "README.md", nodeId: readme.id, created: false });
    } else if (steps.length && readmeNodeId) {
      // Re-sync steps onto whatever README we have after patches.
      ex = state.exercises[exerciseId];
      readme = core.nodeById(ex.nodes, readmeNodeId) || findReadmeNode(ex.nodes);
      if (readme) {
        var synced = core.writeFile(state, {
          exerciseId: exerciseId,
          nodeId: readme.id,
          content: reviseReadmeContent(readme.content || "", steps),
        });
        state = core.normalizeWorkspace(synced.workspace);
        readmeNodeId = readme.id;
      }
    }

    if (!steps.length && readmeNodeId) {
      ex = state.exercises[exerciseId];
      readme = core.nodeById(ex.nodes, readmeNodeId);
      if (readme) steps = extractStepsFromReadme(readme.content || "");
    }

    return {
      workspace: core.presentWorkspace(state),
      readmeNodeId: readmeNodeId,
      steps: steps,
      filesUpdated: filesUpdated,
      changed: filesUpdated.length > 0,
    };
  }

  /**
   * Local (no Claude) apply: essay-derived steps onto README only.
   * Kept for offline / seed browse. Prefer applyClaudeRevision after a model call.
   */
  function applyEssayRevision(workspace, opts) {
    opts = opts || {};
    var steps = Array.isArray(opts.steps) ? opts.steps.slice() : extractStepsFromEssay(opts.essayBody);
    return applyClaudeRevision(workspace, {
      core: opts.core,
      exerciseId: opts.exerciseId,
      essayBody: opts.essayBody,
      steps: steps,
      files: [],
    });
  }

  return {
    extractStepsFromEssay: extractStepsFromEssay,
    extractStepsFromReadme: extractStepsFromReadme,
    findReadmeNode: findReadmeNode,
    reviseReadmeContent: reviseReadmeContent,
    formatStepsSection: formatStepsSection,
    isPracticeFile: isPracticeFile,
    nodeRelPath: nodeRelPath,
    findNodeByPath: findNodeByPath,
    listExerciseFiles: listExerciseFiles,
    applyClaudeRevision: applyClaudeRevision,
    applyEssayRevision: applyEssayRevision,
  };
});
