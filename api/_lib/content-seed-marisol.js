/* Default content for dreamingwithmarisol.com.
 *
 * The JSON is the shape from tlindow/dreamingwithmarisol PR #38:
 * content/site.ts defaults, folded the way lib/content-store.ts folds
 * them into an editable document. data/content.json is not on that
 * branch; the defaults are the document. Import copies these items
 * onto the signed-in user. It does not call a model.
 */

"use strict";

const SEED = require("./content-seed-marisol.json");

const SITE = SEED.site;

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function linkSlug(prefix, link, index) {
  const fromName = slugify(link.name || link.label || "");
  const base = fromName || "item-" + (index + 1);
  return (prefix + "-" + base).slice(0, 120);
}

function item(type, slug, title, body, fields) {
  return {
    site: SITE,
    type,
    slug,
    title: title || slug,
    body: body || "",
    fields: fields || {},
    noteId: null,
    draftKey: "marisol:" + type + ":" + slug,
  };
}

function marisolSeedItems() {
  const items = [];
  const settings = SEED.settings;
  items.push(item(
    "page_section",
    "settings",
    settings.title,
    settings.bookingBannerText,
    settings,
  ));

  const home = SEED.home;
  items.push(item("page_section", "home", home.heroTitle, home.quote, home));

  for (const [slug, page] of Object.entries(SEED.pages)) {
    const sections = Array.isArray(page.sections) ? page.sections : [];
    const body = sections.map((section) => section.body).filter(Boolean).join("\n\n");
    items.push(item(
      "page_section",
      slug,
      page.heroTitle || page.seoTitle || slug,
      body,
      page,
    ));
  }

  for (const product of SEED.products) {
    items.push(item("product", product.slug, product.title, product.description, {
      amountCents: product.amountCents,
      catalogStatus: product.status,
      image: product.image,
      beaconsProductId: product.beaconsProductId,
      stripePriceId: product.stripePriceId || "",
      blobPath: product.blobPath || "",
      fileUrl: product.fileUrl || "",
      postPurchaseMessage: product.postPurchaseMessage || "",
    }));
  }

  for (const event of settings.calendlyEvents) {
    items.push(item("event", slugify(event.name), event.name, event.durationLabel, {
      url: event.url,
      priceLabel: event.priceLabel,
      durationLabel: event.durationLabel,
    }));
  }

  SEED.nav.forEach((link, index) => {
    items.push(item("link", linkSlug("nav", link, index), link.name, link.href, {
      href: link.href,
      external: Boolean(link.external),
      group: "nav",
    }));
  });

  SEED.homeLinks.forEach((link, index) => {
    items.push(item("link", linkSlug("home", link, index), link.label, link.href, {
      href: link.href,
      external: Boolean(link.external),
      group: "home",
    }));
  });

  SEED.instagram.forEach((post, index) => {
    const n = String(index + 1).padStart(2, "0");
    items.push(item("post", "instagram-" + n, "Instagram " + n, post.href, {
      src: post.src,
      href: post.href,
    }));
  });

  return items;
}

module.exports = {
  MARISOL_SITE: SITE,
  SEED,
  marisolSeedItems,
};
