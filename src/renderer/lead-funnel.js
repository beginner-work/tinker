/* Top-of-funnel in the sidebar: North Star + target companies from
 * GET /api/leads?action=funnel. Logos by domain; pay badge; next
 * referrer / recruiter / hiring leader. Tinker never sends.
 */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  var TOKEN_KEY = "tinker_jwt";
  /* DuckDuckGo site icons — free, no API key, no account.
   * https://icons.duckduckgo.com/ip3/<domain>.ico
   * Terms: DuckDuckGo privacy / public icon service (no tracking pixels
   * beyond the image request). Cost: $0. Cached in-memory per session. */
  var LOGO_CACHE = Object.create(null);
  var PAY = {
    clears: { label: "Clears floor", cls: "sidebar__funnel-pay--clears" },
    below: { label: "Below floor", cls: "sidebar__funnel-pay--below" },
    unknown: { label: "No pay data", cls: "sidebar__funnel-pay--unknown" },
  };
  var state = { companies: [], loading: false, error: "", hidden: true };
  var root = null;

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; }
    catch (e) { return ""; }
  }
  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  function logoUrl(domain) {
    var d = String(domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    if (!d) return "";
    return "https://icons.duckduckgo.com/ip3/" + encodeURIComponent(d) + ".ico";
  }
  function logoNode(company, large) {
    var wrap = el("span", "sidebar__funnel-logo" + (large ? " sidebar__funnel-logo--large" : ""));
    var domain = company && company.domain;
    var url = logoUrl(domain);
    var fallback = el("span", "sidebar__funnel-initials", { "aria-hidden": "true" });
    fallback.textContent = initials(company && company.name);
    wrap.appendChild(fallback);
    if (!url) return wrap;
    if (LOGO_CACHE[url] === false) return wrap;
    var img = el("img", "sidebar__funnel-logo-img", {
      alt: "",
      loading: "lazy",
      decoding: "async",
      referrerpolicy: "no-referrer",
    });
    img.src = url;
    img.addEventListener("load", function () {
      LOGO_CACHE[url] = true;
      fallback.hidden = true;
    });
    img.addEventListener("error", function () {
      LOGO_CACHE[url] = false;
      img.remove();
    });
    if (LOGO_CACHE[url] === true) fallback.hidden = true;
    wrap.appendChild(img);
    return wrap;
  }
  function payBadge(status) {
    var info = PAY[status] || PAY.unknown;
    var badge = el("span", "sidebar__funnel-pay " + info.cls, {
      title: info.label,
      "aria-label": info.label,
    });
    badge.textContent = info.label;
    return badge;
  }
  function personSlot(label, person, emptyPrompt) {
    var row = el("div", "sidebar__funnel-person");
    var lab = el("span", "sidebar__funnel-person-label");
    lab.textContent = label;
    row.appendChild(lab);
    if (person && person.id) {
      var link = el("a", "sidebar__funnel-person-link", {
        href: "/leads?lead=" + encodeURIComponent(person.id),
      });
      link.textContent = person.personName || "Someone";
      row.appendChild(link);
    } else {
      var empty = el("a", "sidebar__funnel-person-empty", { href: "/leads" });
      empty.textContent = emptyPrompt || "Add";
      row.appendChild(empty);
    }
    return row;
  }
  function companyCard(entry, featured) {
    var company = entry.company || {};
    var card = el("div", "sidebar__funnel-card" + (featured ? " sidebar__funnel-card--north" : ""));
    var head = el("button", "sidebar__funnel-company", {
      type: "button",
      title: "Show drafts for " + (company.name || "this company"),
    });
    head.appendChild(logoNode(company, featured));
    var nameWrap = el("span", "sidebar__funnel-company-main");
    var name = el("span", "sidebar__funnel-company-name");
    name.textContent = company.name || "Company";
    nameWrap.appendChild(name);
    if (featured) {
      var star = el("span", "sidebar__funnel-north-label");
      star.textContent = "North Star";
      nameWrap.appendChild(star);
    }
    nameWrap.appendChild(payBadge(entry.payStatus));
    head.appendChild(nameWrap);
    head.addEventListener("click", function () {
      if (window.tinkerLeadDrafts && window.tinkerLeadDrafts.setCompanyFilter) {
        window.tinkerLeadDrafts.setCompanyFilter(company.name || "");
      }
    });
    card.appendChild(head);
    var people = el("div", "sidebar__funnel-people");
    if (entry.nextReferrer) people.appendChild(personSlot("Referral", entry.nextReferrer, "Add referral"));
    people.appendChild(personSlot("Recruiter", entry.nextRecruiter, "Add recruiter"));
    people.appendChild(personSlot("Hiring leader", entry.nextHiringLeader, "Add hiring leader"));
    card.appendChild(people);
    return card;
  }
  function render() {
    if (!root) return;
    var list = root.querySelector("[data-funnel-list]");
    var empty = root.querySelector("[data-funnel-empty]");
    var err = root.querySelector("[data-funnel-error]");
    if (!list || !empty || !err) return;
    root.hidden = state.hidden;
    if (state.error) { err.hidden = false; err.textContent = state.error; }
    else { err.hidden = true; err.textContent = ""; }
    list.innerHTML = "";
    empty.hidden = state.companies.length > 0 || !!state.error || state.loading;
    if (!state.companies.length) return;
    state.companies.forEach(function (entry) {
      list.appendChild(companyCard(entry, !!(entry.company && entry.company.northStar)));
    });
  }
  function refresh() {
    if (!token()) {
      state.companies = [];
      state.error = "";
      state.hidden = true;
      render();
      return Promise.resolve();
    }
    state.loading = true;
    return fetch("/api/leads?action=funnel", {
      headers: { Authorization: "Bearer " + token(), Accept: "application/json" },
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (payload) {
        if (!res.ok) {
          var err = new Error((payload && payload.error) || "Request failed");
          err.status = res.status;
          throw err;
        }
        return payload;
      });
    }).then(function (payload) {
      state.companies = Array.isArray(payload.companies) ? payload.companies : [];
      state.error = "";
      state.hidden = false;
    }).catch(function (err) {
      state.companies = [];
      if (err.status === 401 || err.status === 403) {
        state.error = "";
        state.hidden = true;
      } else {
        state.error = "Companies could not load right now.";
        state.hidden = false;
      }
    }).finally(function () {
      state.loading = false;
      render();
    });
  }
  function bindToggle() {
    if (!root) return;
    var toggle = root.querySelector("[data-funnel-toggle]");
    var panel = root.querySelector("[data-funnel-panel]");
    if (!toggle || !panel) return;
    function sync() {
      var open = root.getAttribute("data-open") !== "false";
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }
    toggle.addEventListener("click", function () {
      root.setAttribute("data-open", root.getAttribute("data-open") !== "false" ? "false" : "true");
      sync();
    });
    root.setAttribute(
      "data-open",
      window.matchMedia && window.matchMedia("(max-width: 540px)").matches ? "false" : "true",
    );
    sync();
  }
  function boot() {
    root = document.getElementById("sidebar-funnel");
    if (!root) return;
    bindToggle();
    refresh();
    window.addEventListener("storage", function (e) { if (e.key === TOKEN_KEY) refresh(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
  }
  window.tinkerLeadFunnel = { refresh: refresh };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
