# Switch dreamingwithmarisol.com onto the Tinker content API

TYL-49. The Marisol site still loads copy from `content/site.ts`, then
overlays `data/content.json` or a private Vercel Blob (`lib/content-store.ts`
on `tlindow/dreamingwithmarisol` PR #38, branch `cursor/in-house-cms-a04a`).
`data/content.json` is not in that branch. The defaults in `content/site.ts`
are the document.

Tinker stores that same shape as content items for `dreamingwithmarisol.com`.
The public API returns published items only. Drafts stay off the site.

## API

```
GET https://tinker.beginner.work/api/sites/dreamingwithmarisol.com/content
```

No session. `Cache-Control` is `public, max-age=60, s-maxage=300, stale-while-revalidate=600`.
One slug:

```
GET https://tinker.beginner.work/api/sites/dreamingwithmarisol.com/content/about
```

The list is `{ site, items }`. One slug is `{ item }`. A missing or still-draft
slug is 404. Each published item has `id`, `site`, `type`, `slug`, `title`,
`body`, `fields`, `status` (`published`), and `updatedAt`. It does not include
the owner, `noteId`, or `draftKey`.

`type` is `page_section`, `product`, `event`, `post`, or `link`.

| Item | type | slug | fields |
| --- | --- | --- | --- |
| Site settings | `page_section` | `settings` | the settings object, including `calendlyEvents` |
| Home | `page_section` | `home` | the editable home object |
| A page | `page_section` | the page slug (`about`, `copalero-kit`, …) | the editable page, sections included |
| A shop product | `product` | the product slug | `amountCents`, `catalogStatus` (`available` or `coming-soon`), `image`, `beaconsProductId` |
| A Calendly session | `event` | slug of the event name | `url`, `priceLabel`, `durationLabel` |
| Nav or home link | `link` | `nav-…` or `home-…` | `href`, `external`, `group` (`nav` or `home`) |
| An Instagram tile | `post` | `instagram-01` … | `src`, `href` |

`catalogStatus` is whether the product is for sale. It is not the Tinker
draft/published status.

## Import, then publish

The signed-in owner imports the seed. Connector credentials cannot.

```
POST /api/content
Authorization: Bearer <tinker session>
{ "action": "import" }
```

That creates drafts. The same import again returns the same rows and does not
change them. Publish one item, or pass `"publish": true` on the first import
only (a later import does not publish rows that already exist):

```
POST /api/content
{ "action": "publish", "id": "<item id>" }
```

The owner can also `PATCH /api/content` with `{ "id", "status": "published" }`.
The iOS app can call these same routes with the Tinker session bearer. It does
not need a separate content login.

## Loader

Keep `defaultDocument()` as the fallback. When the API has published items,
use them. When it is empty or down, keep the local defaults.

```ts
const TINKER_CONTENT_URL =
  process.env.TINKER_CONTENT_URL ||
  "https://tinker.beginner.work/api/sites/dreamingwithmarisol.com/content";

export async function loadDocument() {
  const base = defaultDocument();
  try {
    const response = await fetch(TINKER_CONTENT_URL, { next: { revalidate: 60 } });
    if (!response.ok) return base;
    const payload = await response.json();
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) return base;
    const doc = documentFromTinkerItems(items, base);
    return {
      settings: doc.settings,
      home: doc.home,
      pages: doc.pages,
      products: doc.products.length ? doc.products : base.products,
    };
  } catch {
    return base;
  }
}

function findItem(items, type, slug) {
  return items.find((item) => item && item.type === type && item.slug === slug);
}

export function documentFromTinkerItems(items, base) {
  const list = Array.isArray(items) ? items : [];
  const settingsItem = findItem(list, "page_section", "settings");
  const homeItem = findItem(list, "page_section", "home");
  const settings = {
    ...base.settings,
    ...(settingsItem && settingsItem.fields ? settingsItem.fields : {}),
  };
  const home = {
    ...base.home,
    ...(homeItem && homeItem.fields ? homeItem.fields : {}),
  };
  const pages = { ...base.pages };
  for (const item of list) {
    if (!item || item.type !== "page_section") continue;
    if (item.slug === "settings" || item.slug === "home" || !item.fields) continue;
    pages[item.slug] = item.fields;
  }
  const products = list
    .filter((item) => item && item.type === "product" && item.fields)
    .map((item) => ({
      slug: item.slug,
      title: item.title,
      description: item.body,
      amountCents: item.fields.amountCents,
      status: item.fields.catalogStatus,
      image: item.fields.image,
      beaconsProductId: item.fields.beaconsProductId,
      stripePriceId: item.fields.stripePriceId || undefined,
      postPurchaseMessage: item.fields.postPurchaseMessage || undefined,
    }));
  const events = list
    .filter((item) => item && item.type === "event" && item.fields)
    .map((item) => ({
      name: item.title,
      url: item.fields.url,
      priceLabel: item.fields.priceLabel,
      durationLabel: item.fields.durationLabel,
    }));
  if (events.length) settings.calendlyEvents = events;
  return { settings, home, pages, products };
}
```

Nav links, home links, and Instagram tiles are published items too (`link`
and `post`). The current `CmsDocument` does not hold them. Read those items
when the site stops using the constants in `content/site.ts` for `NAV_LINKS`,
`HOME.links`, and `INSTAGRAM_POSTS`.

`imageAlt` on a page still comes from the local fallback inside `toPageCopy`.
The editable page fields match PR #38, which does not store `imageAlt`.

After this loader is in place, the `/admin` editor on the Marisol site can
stay until Marisól edits from Tinker. This repo does not change that site.
