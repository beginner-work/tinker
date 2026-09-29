/* Sidebar hunt funnel above Drafts. Uses GET /api/leads?action=funnel.
 * Logos: DuckDuckGo Icons (https://icons.duckduckgo.com/ip3/{domain}.ico)
 * — free, no API key, no account. Privacy policy:
 * https://duckduckgo.com/privacy. Fallback to initials on error.
 * Cache keys in localStorage. Tinker never sends.
 */
(function () {
  "use strict";
  if (typeof document === "undefined") return;
  var TOKEN_KEY = "tinker_jwt";
  var LOGO_CACHE_KEY = "tinker.funnelLogos.v1";
  var LOGO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  var state = { companies: [], loading: false, error: "" };
  var root = null;

  function token() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } }
  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function api(action) {
    return fetch("/api/leads?action=" + encodeURIComponent(action), {
      headers: { Authorization: "Bearer " + token(), Accept: "application/json" },
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (payload) {
        if (!res.ok) { var err = new Error((payload && payload.error) || "Request failed"); err.status = res.status; throw err; }
        return payload;
      });
    });
  }
  function loadLogoCache() {
    try {
      var raw = localStorage.getItem(LOGO_CACHE_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) { return {}; }
  }
  function saveLogoCache(cache) {
    try { localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* ignore */ }
  }
  function logoUrl(domain) {
    var d = String(domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    return d ? ("https://icons.duckduckgo.com/ip3/" + encodeURIComponent(d) + ".ico") : "";
  }
  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  function payLabel(status) {
    if (status === "clears") return { text: "Clears floor", cls: "sidebar__funnel-pay--clears" };
    if (status === "below") return { text: "Below floor", cls: "sidebar__funnel-pay--below" };
    return { text: "No pay data", cls: "sidebar__funnel-pay--unknown" };
  }
  function personName(lead) {
    return lead && String(lead.personName || "").trim() ? lead.personName.trim() : "";
  }
  function openLead(lead) {
    if (!lead || !lead.id) return;
    if (window.tinkerMessagesShell && typeof window.tinkerMessagesShell.selectLead === "function") {
      window.tinkerMessagesShell.selectLead(lead.id);
      return;
    }
    window.location.assign("/leads?lead=" + encodeURIComponent(lead.id));
  }
  function filterDrafts(company) {
    var name = company && company.name ? company.name : "";
    if (window.tinkerMessagesShell && typeof window.tinkerMessagesShell.setCompanyFilter === "function") {
      window.tinkerMessagesShell.setCompanyFilter(name);
    }
    if (window.tinkerLeadDrafts && typeof window.tinkerLeadDrafts.setCompanyFilter === "function") {
      window.tinkerLeadDrafts.setCompanyFilter(name);
    }
  }
  function logoNode(company, large) {
    var wrap = el("span", "sidebar__funnel-logo" + (large ? " sidebar__funnel-logo--lg" : ""), {
      role: "img", "aria-label": (company.name || "Company") + " logo",
    });
    var domain = company.domain || "";
    var url = logoUrl(domain);
    var cache = loadLogoCache();
    var hit = cache[domain];
    var now = Date.now();
    function showInitials() {
      wrap.textContent = initials(company.name);
      wrap.classList.add("sidebar__funnel-logo--fallback");
    }
    if (!url) { showInitials(); return wrap; }
    if (hit && hit.failed && now - hit.at < LOGO_TTL_MS) { showInitials(); return wrap; }
    if (hit && hit.ok && now - hit.at < LOGO_TTL_MS) {
      var imgCached = el("img", "", { src: url, alt: "" });
      imgCached.addEventListener("error", function () {
        cache[domain] = { failed: true, at: Date.now() }; saveLogoCache(cache);
        wrap.innerHTML = ""; showInitials();
      });
      wrap.appendChild(imgCached); return wrap;
    }
    var img = el("img", "", { src: url, alt: "" });
    img.addEventListener("load", function () {
      cache[domain] = { ok: true, at: Date.now() }; saveLogoCache(cache);
    });
    img.addEventListener("error", function () {
      cache[domain] = { failed: true, at: Date.now() }; saveLogoCache(cache);
      wrap.innerHTML = ""; showInitials();
    });
    wrap.appendChild(img);
    return wrap;
  }
  function slotButton(label, lead, emptyPrompt) {
    if (lead && personName(lead)) {
      var btn = el("button", "sidebar__funnel-person", { type: "button" });
      var kind = el("span", "sidebar__funnel-person-kind"); kind.textContent = label;
      var name = el("span", "sidebar__funnel-person-name"); name.textContent = personName(lead);
      btn.appendChild(kind); btn.appendChild(name);
      btn.addEventListener("click", function (e) { e.stopPropagation(); openLead(lead); });
      return btn;
    }
    var empty = el("span", "sidebar__funnel-person sidebar__funnel-person--empty");
    empty.textContent = emptyPrompt || ("Add " + label.toLowerCase());
    return empty;
  }
  function companyCard(entry, featured) {
    var company = entry.company || {};
    var card = el("article", "sidebar__funnel-card" + (featured ? " sidebar__funnel-card--star" : ""));
    var head = el("button", "sidebar__funnel-company", { type: "button", title: "Show drafts for " + (company.name || "company") });
    head.appendChild(logoNode(company, featured));
    var meta = el("span", "sidebar__funnel-company-meta");
    var name = el("span", "sidebar__funnel-company-name"); name.textContent = company.name || "Company";
    meta.appendChild(name);
    var pay = payLabel(entry.payStatus);
    var badge = el("span", "sidebar__funnel-pay " + pay.cls, { title: pay.text, "aria-label": pay.text });
    badge.textContent = pay.text;
    meta.appendChild(badge);
    head.appendChild(meta);
    head.addEventListener("click", function () { filterDrafts(company); });
    card.appendChild(head);
    var queue = el("div", "sidebar__funnel-queue");
    // Referrer first when present, then recruiter, then hiring leader.
    queue.appendChild(slotButton("Referral", entry.nextReferrer, "Add referrer"));
    queue.appendChild(slotButton("Recruiter", entry.nextRecruiter, "Add recruiter"));
    queue.appendChild(slotButton("Hiring leader", entry.nextHiringLeader, "Add hiring leader"));
    card.appendChild(queue);
    return card;
  }
  function render() {
    if (!root) return;
    var panel = root.querySelector("[data-funnel-panel]");
    var err = root.querySelector("[data-funnel-error]");
    var empty = root.querySelector("[data-funnel-empty]");
    if (!panel || !err || !empty) return;
    if (state.error) { err.hidden = false; err.textContent = state.error; } else { err.hidden = true; err.textContent = ""; }
    panel.innerHTML = "";
    empty.hidden = state.companies.length > 0 || !!state.error || state.loading;
    if (!state.companies.length) return;
    var star = state.companies.filter(function (c) { return c.company && c.company.northStar; });
    var rest = state.companies.filter(function (c) { return !(c.company && c.company.northStar); });
    star.forEach(function (entry) { panel.appendChild(companyCard(entry, true)); });
    rest.forEach(function (entry) { panel.appendChild(companyCard(entry, false)); });
  }
  function refresh() {
    if (!token()) { state.companies = []; state.error = ""; if (root) root.hidden = true; render(); return Promise.resolve(); }
    state.loading = true;
    return api("funnel").then(function (payload) {
      state.companies = Array.isArray(payload.companies) ? payload.companies : [];
      state.error = ""; if (root) root.hidden = false;
    }).catch(function (err) {
      state.companies = [];
      if (err.status === 401 || err.status === 403) { state.error = ""; if (root) root.hidden = true; }
      else { state.error = "Hunt funnel could not load right now."; if (root) root.hidden = false; }
    }).finally(function () { state.loading = false; render(); });
  }
  function bindToggle() {
    if (!root) return;
    var toggle = root.querySelector("[data-funnel-toggle]");
    var panel = root.querySelector("[data-funnel-body]");
    if (!toggle || !panel) return;
    function sync() {
      var open = root.getAttribute("data-open") !== "false";
      panel.hidden = !open; toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
    toggle.addEventListener("click", function () {
      root.setAttribute("data-open", root.getAttribute("data-open") !== "false" ? "false" : "true"); sync();
    });
    root.setAttribute("data-open", window.matchMedia && window.matchMedia("(max-width: 540px)").matches ? "false" : "true");
    sync();
  }
  function boot() {
    root = document.getElementById("sidebar-funnel");
    if (!root) return;
    bindToggle(); refresh();
    window.addEventListener("storage", function (e) { if (e.key === TOKEN_KEY) refresh(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
  }
  window.tinkerLeadFunnel = { refresh: refresh };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
