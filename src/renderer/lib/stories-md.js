/* Story → Markdown file helpers.
 *
 * Pure: no DOM, no FS. Shared by /repo and Node tests.
 *
 * File content is always:
 *   # <title>
 *   <blank line>
 *   <body EXACTLY as stored>
 *
 * Never rewrite, summarize, reformat, or AI-process the body.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerStoriesMd = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAX_SLUG = 80;

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  /** Local calendar date YYYY-MM-DD from an ISO/ms timestamp. */
  function storyDate(isoOrMs, now) {
    var d;
    if (isoOrMs == null || isoOrMs === "") {
      d = now instanceof Date ? now : new Date();
    } else if (isoOrMs instanceof Date) {
      d = isoOrMs;
    } else if (typeof isoOrMs === "number" && Number.isFinite(isoOrMs)) {
      d = new Date(isoOrMs);
    } else {
      d = new Date(String(isoOrMs));
    }
    if (!Number.isFinite(d.getTime())) {
      d = now instanceof Date ? now : new Date();
    }
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function slugifyTitle(title) {
    var raw = String(title == null ? "" : title).trim().toLowerCase();
    if (!raw) return "untitled";
    var slug = raw
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-+/g, "-");
    if (!slug) return "untitled";
    if (slug.length > MAX_SLUG) slug = slug.slice(0, MAX_SLUG).replace(/-+$/g, "");
    return slug || "untitled";
  }

  /** Turn a date-slug filename (or path) into readable words — no .md. */
  function deslugTitle(fileNameOrPath) {
    var name = String(fileNameOrPath == null ? "" : fileNameOrPath).trim();
    if (!name) return "";
    name = name.replace(/\\/g, "/");
    var slash = name.lastIndexOf("/");
    if (slash >= 0) name = name.slice(slash + 1);
    name = name.replace(/\.md$/i, "");
    name = name.replace(/^\d{4}-\d{2}-\d{2}-/, "");
    if (!name || name === "untitled") return "Untitled";
    return name.replace(/-+/g, " ").replace(/\s+/g, " ").trim();
  }

  /** First ATX `# heading` in markdown, or empty string. */
  function headingTitle(markdown) {
    var lines = String(markdown == null ? "" : markdown).split(/\r?\n/);
    for (var i = 0; i < lines.length; i += 1) {
      var m = String(lines[i] || "").match(/^#\s+(.+?)\s*$/);
      if (m && m[1]) return String(m[1]).trim().slice(0, 120);
    }
    return "";
  }

  /**
   * Human title for UI: first Markdown heading, else story.title, else
   * de-slugged filename. Never includes .md or a folder path.
   */
  function displayTitle(story) {
    if (!story) return "Untitled";
    var fromHeading = headingTitle(story.markdown || story.body || "");
    if (fromHeading) return fromHeading;
    var titled = story.title != null ? String(story.title).trim() : "";
    if (titled) return titled.slice(0, 120);
    var fromFile = deslugTitle(story.fileName || story.relPath || "");
    return fromFile || "Untitled";
  }

  /**
   * Markdown bytes for a story. Body is concatenated byte-for-byte after
   * the heading and blank line — no trimming, no line-ending rewrites.
   */
  function storyMarkdown(title, body) {
    var t = String(title == null ? "" : title);
    var b = body == null ? "" : String(body);
    if (t === "" && b === "") return "";
    if (t === "") return b;
    return "# " + t + "\n\n" + b;
  }

  function storyFileName(story, now) {
    var title = story && story.title != null ? story.title : "";
    var when = story && (story.createdAt || story.updatedAt);
    return storyDate(when, now) + "-" + slugifyTitle(title) + ".md";
  }

  function storyRelPath(story, now) {
    return "stories/" + storyFileName(story, now);
  }

  /**
   * Assign unique relPaths when date+slug collide. First keeps the plain
   * name; later ones append a short id suffix before .md.
   */
  function uniqueStoryFiles(stories, now) {
    var seen = Object.create(null);
    var list = Array.isArray(stories) ? stories : [];
    return list.map(function (story) {
      var base = storyRelPath(story, now);
      var relPath = base;
      if (seen[base]) {
        var id = String((story && story.id) || "").replace(/[^a-zA-Z0-9_-]/g, "");
        if (!id) id = String(seen[base]);
        relPath = base.replace(/\.md$/i, "-" + id.slice(-12) + ".md");
        while (seen[relPath]) {
          relPath = base.replace(/\.md$/i, "-" + id.slice(-12) + "-" + seen[base] + ".md");
          seen[base] += 1;
        }
      }
      seen[base] = (seen[base] || 0) + 1;
      seen[relPath] = 1;
      return {
        id: story && story.id != null ? String(story.id) : "",
        title: story && story.title != null ? String(story.title) : "",
        body: story && story.body != null ? String(story.body) : "",
        createdAt: story && story.createdAt != null ? String(story.createdAt) : "",
        updatedAt: story && story.updatedAt != null ? String(story.updatedAt) : "",
        fileName: relPath.slice("stories/".length),
        relPath: relPath,
        markdown: storyMarkdown(
          story && story.title != null ? story.title : "",
          story && story.body != null ? story.body : ""
        ),
      };
    });
  }

  /**
   * True when it is safe to write: file is missing, or local bytes already
   * match. False when local content differs (must not overwrite).
   */
  function shouldWriteStoryFile(localText, desiredMarkdown) {
    if (localText == null) return true;
    return String(localText) === String(desiredMarkdown);
  }

  /** True only when the file is absent and should be created. */
  function needsStoryFileWrite(localText, desiredMarkdown) {
    if (localText == null) return true;
    return false;
  }

  /** Minimal store-only ZIP (no compression) for web download-all. */
  function buildZip(files) {
    var list = Array.isArray(files) ? files : [];
    var parts = [];
    var central = [];
    var offset = 0;

    function u16(n) {
      return String.fromCharCode(n & 0xff, (n >> 8) & 0xff);
    }
    function u32(n) {
      return String.fromCharCode(
        n & 0xff,
        (n >> 8) & 0xff,
        (n >> 16) & 0xff,
        (n >> 24) & 0xff
      );
    }
    function crc32(str) {
      var table = crc32.table;
      if (!table) {
        table = new Array(256);
        for (var i = 0; i < 256; i += 1) {
          var c = i;
          for (var k = 0; k < 8; k += 1) {
            c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
          }
          table[i] = c >>> 0;
        }
        crc32.table = table;
      }
      var crc = 0xffffffff;
      for (var j = 0; j < str.length; j += 1) {
        crc = table[(crc ^ str.charCodeAt(j)) & 0xff] ^ (crc >>> 8);
      }
      return (crc ^ 0xffffffff) >>> 0;
    }

    for (var i = 0; i < list.length; i += 1) {
      var name = String(list[i].name || list[i].relPath || "file.md");
      var data = String(list[i].text == null ? list[i].markdown || "" : list[i].text);
      // ZIP paths use forward slashes; encode as binary Latin-1 of UTF-8 bytes.
      var nameBytes = unescape(encodeURIComponent(name));
      var dataBytes = unescape(encodeURIComponent(data));
      var crc = crc32(dataBytes);
      var size = dataBytes.length;
      var local =
        "PK\x03\x04" +
        u16(20) +
        u16(0) +
        u16(0) +
        u16(0) +
        u16(0) +
        u32(crc) +
        u32(size) +
        u32(size) +
        u16(nameBytes.length) +
        u16(0) +
        nameBytes +
        dataBytes;
      parts.push(local);
      var cen =
        "PK\x01\x02" +
        u16(20) +
        u16(20) +
        u16(0) +
        u16(0) +
        u16(0) +
        u16(0) +
        u32(crc) +
        u32(size) +
        u32(size) +
        u16(nameBytes.length) +
        u16(0) +
        u16(0) +
        u16(0) +
        u16(0) +
        u32(0) +
        u32(offset) +
        nameBytes;
      central.push(cen);
      offset += local.length;
    }

    var centralDir = central.join("");
    var end =
      "PK\x05\x06" +
      u16(0) +
      u16(0) +
      u16(list.length) +
      u16(list.length) +
      u32(centralDir.length) +
      u32(offset) +
      u16(0);
    var binary = parts.join("") + centralDir + end;
    var out = new Uint8Array(binary.length);
    for (var b = 0; b < binary.length; b += 1) out[b] = binary.charCodeAt(b) & 0xff;
    return out;
  }

  return {
    storyDate: storyDate,
    slugifyTitle: slugifyTitle,
    deslugTitle: deslugTitle,
    headingTitle: headingTitle,
    displayTitle: displayTitle,
    storyMarkdown: storyMarkdown,
    storyFileName: storyFileName,
    storyRelPath: storyRelPath,
    uniqueStoryFiles: uniqueStoryFiles,
    shouldWriteStoryFile: shouldWriteStoryFile,
    needsStoryFileWrite: needsStoryFileWrite,
    buildZip: buildZip,
  };
});
