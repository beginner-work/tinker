/* open-beginner.js — switch surfaces from tinker to the beginner app.
 *
 * tinker is the quiet writing surface; beginner (www.beginner.work) is the
 * public surface — your page and your backers. They're two apps you walk
 * between. This is the reciprocal of beginner's drawer "Open tinker": the
 * profile menu's "Open beginner" hops over to the beginner home.
 *
 * The founder is signed into tinker but has no session on beginner (a
 * different origin), so we carry the session token across in the URL
 * fragment (#ts=<token>) — the on-device-only channel back-me.js and
 * pwa-session.js use, since a fragment is never sent to a server. beginner's
 * drawer-auth.js reads `ts`, exchanges it for a beginner session, and scrubs
 * the token from the URL, so the founder lands signed in with no second code.
 *
 * Switching surfaces always means *leaving* tinker for the other app, so we
 * hand off to the system browser / new context — not an in-app iframe (that's
 * back-me.js's job, for showing a QR without leaving).
 *
 * Exposed as window.tinkerOpenBeginner; profile.js wires the menu item.
 */
(function () {
  "use strict";

  // www, not the bare apex: the apex 308-redirects to www; linking straight
  // to www keeps the carried `ts` fragment intact (matches back-me.js).
  var HOME = "https://www.beginner.work/";

  function token() {
    try { return localStorage.getItem("tinker_jwt") || ""; }
    catch (e) { return ""; }
  }

  function url() {
    var t = token();
    return t ? HOME + "#ts=" + encodeURIComponent(t) : HOME;
  }

  function openExternal(u) {
    if (window.tinker && typeof window.tinker.openExternal === "function") {
      window.tinker.openExternal(u);
    } else {
      window.open(u, "_blank", "noopener,noreferrer");
    }
  }

  function open() { openExternal(url()); }

  window.tinkerOpenBeginner = { open: open, url: url };
})();
