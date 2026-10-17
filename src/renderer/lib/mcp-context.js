/* Selected MCP context pages for writing (business context + technical goals).
 *
 * Display-only helper + local persistence. Server reconstruct/classify can
 * receive the text snippets the owner picked. Does not call MCP itself.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.tinkerMcpContext = api;
  } else if (root) {
    root.tinkerMcpContext = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var STORAGE_KEY = "tinker_mcp_context_v1";
  var MAX_PAGES = 6;
  var MAX_TITLE = 160;
  var MAX_SNIPPET = 4000;

  function clamp(text, max) {
    var s = text == null ? "" : String(text);
    if (s.length <= max) return s;
    return s.slice(0, max);
  }

  function normalizePage(raw) {
    if (!raw || typeof raw !== "object") return null;
    var id = String(raw.id || raw.pageId || "").trim();
    var title = clamp(raw.title || raw.name || "", MAX_TITLE).trim();
    if (!id && !title) return null;
    return {
      id: id || title,
      title: title || id,
      connectorId: String(raw.connectorId || "notion").trim() || "notion",
      snippet: clamp(raw.snippet || raw.text || "", MAX_SNIPPET),
      role: raw.role === "technical" ? "technical" : "business",
    };
  }

  function emptyContext() {
    return { business: [], technical: [] };
  }

  function normalizeContext(raw) {
    var base = emptyContext();
    if (!raw || typeof raw !== "object") return base;
    var business = Array.isArray(raw.business) ? raw.business : [];
    var technical = Array.isArray(raw.technical) ? raw.technical : [];
    base.business = business
      .map(function (p) {
        var n = normalizePage(Object.assign({}, p, { role: "business" }));
        return n;
      })
      .filter(Boolean)
      .slice(0, MAX_PAGES);
    base.technical = technical
      .map(function (p) {
        var n = normalizePage(Object.assign({}, p, { role: "technical" }));
        return n;
      })
      .filter(Boolean)
      .slice(0, MAX_PAGES);
    return base;
  }

  function readLocal() {
    try {
      if (typeof localStorage === "undefined") return emptyContext();
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyContext();
      return normalizeContext(JSON.parse(raw));
    } catch (e) {
      return emptyContext();
    }
  }

  function writeLocal(ctx) {
    var next = normalizeContext(ctx);
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
    } catch (e) { /* ignore */ }
    return next;
  }

  function setPage(role, page) {
    var ctx = readLocal();
    var key = role === "technical" ? "technical" : "business";
    var nextPage = normalizePage(
      Object.assign({}, page, { role: key === "technical" ? "technical" : "business" })
    );
    if (!nextPage) return ctx;
    var list = ctx[key].filter(function (p) {
      return p.id !== nextPage.id;
    });
    list.unshift(nextPage);
    ctx[key] = list.slice(0, MAX_PAGES);
    return writeLocal(ctx);
  }

  function clearRole(role) {
    var ctx = readLocal();
    if (role === "technical") ctx.technical = [];
    else ctx.business = [];
    return writeLocal(ctx);
  }

  function joinSnippets(pages) {
    var list = Array.isArray(pages) ? pages : [];
    var parts = [];
    for (var i = 0; i < list.length; i += 1) {
      var p = list[i];
      if (!p) continue;
      var block = (p.title ? p.title + "\n" : "") + (p.snippet || "");
      block = block.trim();
      if (block) parts.push(block);
    }
    return parts.join("\n\n---\n\n");
  }

  function getBusinessContext() {
    return joinSnippets(readLocal().business);
  }

  function getTechnicalGoalsContext() {
    return joinSnippets(readLocal().technical);
  }

  function indicatorLabel(ctx) {
    var c = normalizeContext(ctx || readLocal());
    var bits = [];
    if (c.business.length) {
      bits.push(
        "Business: " +
          c.business
            .map(function (p) {
              return p.title;
            })
            .join(", ")
      );
    }
    if (c.technical.length) {
      bits.push(
        "Technical: " +
          c.technical
            .map(function (p) {
              return p.title;
            })
            .join(", ")
      );
    }
    return bits.join(" · ");
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    emptyContext: emptyContext,
    normalizeContext: normalizeContext,
    normalizePage: normalizePage,
    readLocal: readLocal,
    writeLocal: writeLocal,
    setPage: setPage,
    clearRole: clearRole,
    getBusinessContext: getBusinessContext,
    getTechnicalGoalsContext: getTechnicalGoalsContext,
    indicatorLabel: indicatorLabel,
  };
});
