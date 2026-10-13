# Catalog

Public storefront API (no sign-in): categories, browsing/search, product pages and the home page rails. Interactive reference at `/api/docs` (tag **Catalog**).

## Endpoints

All paths are relative to `/api/v1`. Only `ACTIVE` products are ever returned (`DRAFT` and `SOLD` are hidden).

| Method | Path | Query | Returns |
| --- | --- | --- | --- |
| GET | `/catalog/home` | `prefer?` | `{categories, flashSale: {endsAt, items}, newItems, justForYou}` — everything the home page needs |
| GET | `/categories` | – | `Category[]` (ordered by `sortOrder`, with `productCount`) |
| GET | `/products` | `q?, category?, sort?, minPrice?, maxPrice?, page?, limit?` | `{items, total, page, limit}` |
| GET | `/products/flash-sale` | `limit?` | `{endsAt, items}` |
| GET | `/products/new` | `limit?` | `Product[]` |
| GET | `/products/just-for-you` | `category?, prefer?, exclude?, limit?` | `Product[]` |
| GET | `/products/:id` | – | `Product` (404 `PRODUCT_NOT_FOUND`) |
| GET | `/products/:id/similar` | `limit?` | `Product[]` |

- `sort`: `newest` (default), `price_asc`, `price_desc`, `rating`, `popular`. `limit` ≤ 60 for `/products`, ≤ 24 elsewhere.
- `q` searches name, tags and description (case-insensitive).
- `prefer` / `exclude` are comma-separated category slugs / product ids.

## Product

`id` is the URL slug. Prices are plain numbers in naira.

```json
{
  "id": "olive-low-top-sneakers",
  "name": "Olive low-top sneakers",
  "image": "/images/l-olive-sneakers.png",
  "gallery": [],
  "price": 17000,
  "oldPrice": 21250,
  "badge": { "label": "-20%", "tone": "sale" },
  "category": "clothing",
  "categoryName": "Clothing",
  "tags": "Clothing · Footwear",
  "location": "Lagos, Nigeria",
  "rating": 4,
  "reviews": 20,
  "variations": [],
  "flashSaleEndsAt": "2026-10-20T18:00:00.000Z",
  "createdAt": "2026-08-14T18:00:00.000Z"
}
```

## How the rails are chosen

- **Flash sale:** has an `oldPrice` and `flashSaleEndsAt` in the future; ending soonest first. The badge shows the discount.
- **New items:** listed in the last 30 days (`NEW_ITEM_DAYS`), newest first; they get the "New" badge.
- **Just For You:** ranked by `featuredScore` (editorial boost), then rating and number of reviews; categories in `prefer` (the web app sends the shopper's wishlist/cart categories) rank first. On the home page it skips items already shown in the flash sale and new items.
- **Similar:** same category (best rated), topped up from other categories.

## Data

Tables `categories` and `products` (see `prisma/schema.prisma`). Products can belong to a seller (`seller_id`) for when selling goes live.

Starter data — the categories and products in the designs:

```bash
npx prisma migrate deploy
npx prisma db seed      # safe to re-run; refreshes flash-sale end dates
```

## Search

`GET /products?q=…` matches **every word** of the query (in any order) against the product name, tags, category name and description, case-insensitively. When `q` is given the default sort is `relevance` (name matches first, then tags/category, then description; ties broken by featured score and newest). Other sorts still work: `newest`, `price_asc`, `price_desc`, `rating`, `popular`.

`GET /search/suggestions?q=…&limit=6` powers the search box drop-down: `{ query, categories[], products[], total }`. An empty `q` returns empty lists (no error).

The web header search box shows these suggestions as you type (arrow keys + Enter work), and the results page has a sort picker.
