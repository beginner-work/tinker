/* Pure helpers for per-owner exercise file trees.
 *
 * Shared by the API store and the /repo explorer. Seed comes from
 * checked-in tlindow/lindowlabs snapshots. Saved owner trees are never
 * overwritten by seed/sync; new upstream exercises are appended.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerExerciseWorkspaceCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAX_NODES_PER_EXERCISE = 400;
  var MAX_NAME_LEN = 120;
  var MAX_CONTENT_CHARS = 120000;
  var MAX_EXERCISES = 40;
  var NAME_RE = /^[^\\/:*?"<>|\0]+$/;

  function fail(status, message, extra) {
    var err = new Error(message);
    err.status = status;
    if (extra) {
      Object.keys(extra).forEach(function (key) {
        err[key] = extra[key];
      });
    }
    return err;
  }

  function newId(prefix) {
    var rand = "";
    try {
      if (typeof require === "function") {
        rand = require("crypto").randomBytes(6).toString("hex");
      }
    } catch (e) { /* browser */ }
    if (!rand) {
      rand = Math.random().toString(16).slice(2) + Date.now().toString(16);
      rand = rand.slice(0, 12);
    }
    return String(prefix || "n") + "_" + rand;
  }

  function normalizeName(raw) {
    var name = String(raw == null ? "" : raw).trim();
    if (!name) throw fail(400, "Name is required.");
    if (name.length > MAX_NAME_LEN) throw fail(400, "Name is too long.");
    if (name === "." || name === "..") throw fail(400, "Invalid name.");
    if (!NAME_RE.test(name)) throw fail(400, "Name has invalid characters.");
    return name;
  }

  function emptyWorkspace() {
    return { exerciseOrder: [], exercises: {} };
  }

  function presentNode(node) {
    var out = {
      id: String(node.id),
      name: String(node.name),
      type: node.type === "folder" ? "folder" : "file",
      parentId: node.parentId == null || node.parentId === "" ? null : String(node.parentId),
    };
    if (out.type === "file") out.content = node.content == null ? "" : String(node.content);
    return out;
  }

  function presentExercise(ex) {
    return {
      id: String(ex.id),
      name: String(ex.name || ex.id),
      nodes: Array.isArray(ex.nodes) ? ex.nodes.map(presentNode) : [],
    };
  }

  function presentWorkspace(state) {
    var order = Array.isArray(state.exerciseOrder) ? state.exerciseOrder.slice() : [];
    var exercises = {};
    order.forEach(function (id) {
      if (state.exercises && state.exercises[id]) {
        exercises[id] = presentExercise(state.exercises[id]);
      }
    });
    Object.keys(state.exercises || {}).forEach(function (id) {
      if (!exercises[id]) {
        order.push(id);
        exercises[id] = presentExercise(state.exercises[id]);
      }
    });
    return { exerciseOrder: order, exercises: exercises };
  }

  function normalizeWorkspace(raw) {
    var data = raw && typeof raw === "object" ? raw : {};
    var exercises = {};
    var src = data.exercises && typeof data.exercises === "object" ? data.exercises : {};
    Object.keys(src).forEach(function (id) {
      var row = src[id];
      if (!row || !row.id) return;
      var nodes = Array.isArray(row.nodes)
        ? row.nodes.filter(function (n) { return n && n.id && n.name; }).map(presentNode)
        : [];
      exercises[String(row.id)] = {
        id: String(row.id),
        name: String(row.name || row.id),
        nodes: nodes,
      };
    });
    var order = Array.isArray(data.exerciseOrder)
      ? data.exerciseOrder.map(String).filter(function (id) { return !!exercises[id]; })
      : [];
    Object.keys(exercises).forEach(function (id) {
      if (order.indexOf(id) === -1) order.push(id);
    });
    return { exerciseOrder: order, exercises: exercises };
  }

  function nodesFromSeedPaths(seedNodes) {
    var list = Array.isArray(seedNodes) ? seedNodes.slice() : [];
    list.sort(function (a, b) {
      var ap = String(a.path || "");
      var bp = String(b.path || "");
      var ad = ap.split("/").length;
      var bd = bp.split("/").length;
      if (ad !== bd) return ad - bd;
      if (ap === bp) return a.type === "folder" ? -1 : 1;
      return ap < bp ? -1 : 1;
    });
    var byPath = Object.create(null);
    var nodes = [];
    list.forEach(function (row) {
      var path = String(row.path || "").replace(/^\/+|\/+$/g, "");
      if (!path) return;
      var parts = path.split("/");
      var name = parts[parts.length - 1];
      var parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
      var parentId = parentPath ? byPath[parentPath] : null;
      if (parentPath && !parentId) return;
      var type = row.type === "folder" ? "folder" : "file";
      var id = newId(type === "folder" ? "dir" : "file");
      var node = { id: id, name: name, type: type, parentId: parentId };
      if (type === "file") node.content = row.content == null ? "" : String(row.content);
      nodes.push(node);
      byPath[path] = id;
    });
    return nodes;
  }

  function buildSeedWorkspace(seedJson, manifestModules) {
    var seed = seedJson && typeof seedJson === "object" ? seedJson : {};
    var seedExercises = seed.exercises && typeof seed.exercises === "object" ? seed.exercises : {};
    var modules = Array.isArray(manifestModules) ? manifestModules : [];
    var state = emptyWorkspace();

    modules.forEach(function (mod) {
      if (!mod || !mod.id) return;
      var id = String(mod.id);
      var seedRow = seedExercises[id];
      var nodes = seedRow ? nodesFromSeedPaths(seedRow.nodes) : [];
      state.exercises[id] = { id: id, name: String(mod.name || id), nodes: nodes };
      state.exerciseOrder.push(id);
    });

    Object.keys(seedExercises).forEach(function (id) {
      if (state.exercises[id]) return;
      state.exercises[id] = {
        id: id,
        name: id,
        nodes: nodesFromSeedPaths(seedExercises[id].nodes),
      };
      state.exerciseOrder.push(id);
    });

    return state;
  }

  function mergeSeedIntoSaved(savedRaw, seedWorkspace) {
    var saved = normalizeWorkspace(savedRaw);
    var seed = normalizeWorkspace(seedWorkspace);
    var next = {
      exerciseOrder: saved.exerciseOrder.slice(),
      exercises: Object.assign({}, saved.exercises),
    };

    seed.exerciseOrder.forEach(function (id) {
      if (next.exercises[id]) return;
      next.exercises[id] = presentExercise(seed.exercises[id]);
      next.exerciseOrder.push(id);
    });

    seed.exerciseOrder.forEach(function (id) {
      if (!next.exercises[id] || !seed.exercises[id]) return;
      next.exercises[id].name = seed.exercises[id].name || next.exercises[id].name;
    });

    return normalizeWorkspace(next);
  }

  function getExercise(state, exerciseId) {
    var id = String(exerciseId || "").trim();
    if (!id) throw fail(400, "exerciseId is required.");
    var ex = state.exercises[id];
    if (!ex) throw fail(404, "Exercise not found.");
    return ex;
  }

  function nodeById(nodes, nodeId) {
    var id = String(nodeId || "").trim();
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i].id === id) return nodes[i];
    }
    return null;
  }

  function childNodes(nodes, parentId) {
    var parent = parentId == null || parentId === "" ? null : String(parentId);
    return nodes.filter(function (n) {
      return (n.parentId || null) === parent;
    });
  }

  function assertNoDuplicateName(nodes, parentId, name, exceptId) {
    var lower = String(name).toLowerCase();
    childNodes(nodes, parentId).forEach(function (n) {
      if (exceptId && n.id === exceptId) return;
      if (String(n.name).toLowerCase() === lower) {
        throw fail(400, "A file or folder with that name already exists here.");
      }
    });
  }

  function isDescendant(nodes, maybeDescendantId, ancestorId) {
    var cur = nodeById(nodes, maybeDescendantId);
    var seen = {};
    while (cur && cur.parentId) {
      if (cur.parentId === ancestorId) return true;
      if (seen[cur.id]) return false;
      seen[cur.id] = true;
      cur = nodeById(nodes, cur.parentId);
    }
    return false;
  }

  function collectDescendantIds(nodes, rootId) {
    var out = [];
    var queue = [String(rootId)];
    var seen = {};
    seen[queue[0]] = true;
    while (queue.length) {
      var id = queue.shift();
      nodes.forEach(function (n) {
        if (n.parentId === id && !seen[n.id]) {
          seen[n.id] = true;
          out.push(n.id);
          queue.push(n.id);
        }
      });
    }
    return out;
  }

  function createNode(state, opts) {
    opts = opts || {};
    var ex = getExercise(state, opts.exerciseId);
    if (ex.nodes.length >= MAX_NODES_PER_EXERCISE) {
      throw fail(400, "Node limit reached for this exercise.");
    }
    var kind = opts.type === "folder" ? "folder" : "file";
    var nodeName = normalizeName(opts.name);
    var parent = opts.parentId == null || opts.parentId === "" ? null : String(opts.parentId);
    if (parent) {
      var parentNode = nodeById(ex.nodes, parent);
      if (!parentNode) throw fail(404, "Parent folder not found.");
      if (parentNode.type !== "folder") throw fail(400, "Parent must be a folder.");
    }
    assertNoDuplicateName(ex.nodes, parent, nodeName);
    var node = {
      id: newId(kind === "folder" ? "dir" : "file"),
      name: nodeName,
      type: kind,
      parentId: parent,
    };
    if (kind === "file") {
      var text = opts.content == null ? "" : String(opts.content);
      if (text.length > MAX_CONTENT_CHARS) throw fail(400, "File content is too large.");
      node.content = text;
    }
    ex.nodes.push(node);
    return { node: presentNode(node), workspace: presentWorkspace(state) };
  }

  function renameNode(state, opts) {
    opts = opts || {};
    var ex = getExercise(state, opts.exerciseId);
    var node = nodeById(ex.nodes, opts.nodeId);
    if (!node) throw fail(404, "Node not found.");
    var nodeName = normalizeName(opts.name);
    assertNoDuplicateName(ex.nodes, node.parentId, nodeName, node.id);
    node.name = nodeName;
    return { node: presentNode(node), workspace: presentWorkspace(state) };
  }

  function moveNode(state, opts) {
    opts = opts || {};
    var ex = getExercise(state, opts.exerciseId);
    var node = nodeById(ex.nodes, opts.nodeId);
    if (!node) throw fail(404, "Node not found.");
    var parent = opts.parentId == null || opts.parentId === "" ? null : String(opts.parentId);
    if (parent === node.id) throw fail(400, "A folder cannot contain itself.");
    if (parent) {
      var parentNode = nodeById(ex.nodes, parent);
      if (!parentNode) throw fail(404, "Parent folder not found.");
      if (parentNode.type !== "folder") throw fail(400, "Parent must be a folder.");
      if (node.type === "folder" && isDescendant(ex.nodes, parent, node.id)) {
        throw fail(400, "Cannot move a folder into its descendant.");
      }
    }
    assertNoDuplicateName(ex.nodes, parent, node.name, node.id);
    node.parentId = parent;

    if (opts.beforeId) {
      var others = ex.nodes.filter(function (n) { return n.id !== node.id; });
      var siblings = others.filter(function (n) {
        return (n.parentId || null) === parent;
      });
      var rest = others.filter(function (n) {
        return (n.parentId || null) !== parent;
      });
      var nextSiblings = [];
      var placed = false;
      siblings.forEach(function (n) {
        if (n.id === String(opts.beforeId)) {
          nextSiblings.push(node);
          placed = true;
        }
        nextSiblings.push(n);
      });
      if (!placed) nextSiblings.push(node);
      ex.nodes = rest.concat(nextSiblings);
    }

    return { node: presentNode(node), workspace: presentWorkspace(state) };
  }

  function deleteNode(state, opts) {
    opts = opts || {};
    var ex = getExercise(state, opts.exerciseId);
    var node = nodeById(ex.nodes, opts.nodeId);
    if (!node) throw fail(404, "Node not found.");
    var descendantIds = node.type === "folder" ? collectDescendantIds(ex.nodes, node.id) : [];
    var total = 1 + descendantIds.length;
    if (node.type === "folder" && descendantIds.length && !opts.confirm) {
      throw fail(409, "Folder is not empty.", {
        code: "folder_not_empty",
        nodeCount: descendantIds.length,
      });
    }
    var remove = {};
    remove[node.id] = true;
    descendantIds.forEach(function (id) { remove[id] = true; });
    ex.nodes = ex.nodes.filter(function (n) { return !remove[n.id]; });
    return {
      deletedId: node.id,
      deletedCount: total,
      workspace: presentWorkspace(state),
    };
  }

  function writeFile(state, opts) {
    opts = opts || {};
    var ex = getExercise(state, opts.exerciseId);
    var node = nodeById(ex.nodes, opts.nodeId);
    if (!node) throw fail(404, "Node not found.");
    if (node.type !== "file") throw fail(400, "Only files have content.");
    var text = opts.content == null ? "" : String(opts.content);
    if (text.length > MAX_CONTENT_CHARS) throw fail(400, "File content is too large.");
    node.content = text;
    return { node: presentNode(node), workspace: presentWorkspace(state) };
  }

  function reorderExercises(state, opts) {
    opts = opts || {};
    if (!Array.isArray(opts.order)) throw fail(400, "order must be an array.");
    var ids = opts.order.map(String);
    var seen = {};
    ids.forEach(function (id) {
      if (!state.exercises[id]) throw fail(400, "Unknown exercise in order: " + id);
      if (seen[id]) throw fail(400, "Duplicate exercise in order.");
      seen[id] = true;
    });
    Object.keys(state.exercises).forEach(function (id) {
      if (!seen[id]) ids.push(id);
    });
    if (ids.length > MAX_EXERCISES) throw fail(400, "Too many exercises.");
    state.exerciseOrder = ids;
    return { workspace: presentWorkspace(state) };
  }

  return {
    MAX_NODES_PER_EXERCISE: MAX_NODES_PER_EXERCISE,
    MAX_CONTENT_CHARS: MAX_CONTENT_CHARS,
    fail: fail,
    emptyWorkspace: emptyWorkspace,
    presentWorkspace: presentWorkspace,
    normalizeWorkspace: normalizeWorkspace,
    nodesFromSeedPaths: nodesFromSeedPaths,
    buildSeedWorkspace: buildSeedWorkspace,
    mergeSeedIntoSaved: mergeSeedIntoSaved,
    createNode: createNode,
    renameNode: renameNode,
    moveNode: moveNode,
    deleteNode: deleteNode,
    writeFile: writeFile,
    reorderExercises: reorderExercises,
    childNodes: childNodes,
    nodeById: nodeById,
    collectDescendantIds: collectDescendantIds,
  };
});
