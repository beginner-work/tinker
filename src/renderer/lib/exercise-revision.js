/* exercise-revision.js - revise exercise README / step lists from an essay.
 *
 * When the owner finishes an essay tagged to an exercise ("This is everything"),
 * we rewrite the exercise's README "Start here" (or equivalent) step list to
 * match what the essay asks for. Practice / starter code files are never
 * rewritten here (they stay blank stubs).
 *
 * Persists by updating README.md content inside the existing exercise
 * workspace model (TinkerUserData). GitHub / tlindow/lindowlabs is not written.
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

  /**
   * Apply essay-derived steps onto an exercise inside a workspace.
   * Returns { workspace, readmeNodeId, steps, changed }.
   * Never mutates practice file contents.
   */
  function applyEssayRevision(workspace, opts) {
    opts = opts || {};
    var core = opts.core;
    if (!core) throw new Error("exercise core required");
    var exerciseId = String(opts.exerciseId || "").trim();
    if (!exerciseId) throw new Error("exerciseId is required");
    var steps = Array.isArray(opts.steps) ? opts.steps.slice() : extractStepsFromEssay(opts.essayBody);
    if (!steps.length && opts.essayBody) {
      // Fallback: one goal from the essay title / first non-empty line.
      var first = String(opts.essayBody).split(/\r?\n/).map(function (l) {
        return l.trim();
      }).filter(Boolean)[0];
      if (first) steps = ["Revise the exercise to match: " + first.slice(0, 160)];
    }
    if (!steps.length) {
      return {
        workspace: core.presentWorkspace(workspace),
        readmeNodeId: null,
        steps: [],
        changed: false,
      };
    }

    var state = core.normalizeWorkspace(workspace);
    var ex = state.exercises[exerciseId];
    if (!ex) throw Object.assign(new Error("Exercise not found."), { status: 404 });

    var readme = findReadmeNode(ex.nodes);
    if (!readme) {
      // Create a README at the exercise root so the revision has a home.
      var created = core.createNode(state, {
        exerciseId: exerciseId,
        type: "file",
        name: "README.md",
        parentId: null,
        content: "# " + (ex.name || exerciseId) + "\n\n",
      });
      state = core.normalizeWorkspace(created.workspace);
      ex = state.exercises[exerciseId];
      readme = findReadmeNode(ex.nodes);
    }

    // Guard: never rewrite practice files as part of this revision.
    ex.nodes.forEach(function (n) {
      if (isPracticeFile(n) && opts.clearPractice !== false) {
        // Leave content as-is unless explicitly blanking stubs that were
        // somehow filled. Default: do not touch.
      }
    });

    var nextContent = reviseReadmeContent(readme.content || "", steps);
    var written = core.writeFile(state, {
      exerciseId: exerciseId,
      nodeId: readme.id,
      content: nextContent,
    });

    return {
      workspace: written.workspace,
      readmeNodeId: readme.id,
      steps: steps,
      changed: true,
    };
  }

  return {
    extractStepsFromEssay: extractStepsFromEssay,
    extractStepsFromReadme: extractStepsFromReadme,
    findReadmeNode: findReadmeNode,
    reviseReadmeContent: reviseReadmeContent,
    formatStepsSection: formatStepsSection,
    isPracticeFile: isPracticeFile,
    applyEssayRevision: applyEssayRevision,
  };
});
