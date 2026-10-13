# Wishlist, cart and selling

## Wishlist & cart

Signed-out shoppers keep their wishlist and cart in the browser. When they sign in, the web app sends both to the API (`POST /wishlist/merge`, `POST /cart/merge`); from then on the account's wishlist and cart are used on every device. Signing out empties the screen (the account keeps its items).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/wishlist` | – | `Product[]` |
| PUT | `/wishlist/:productId` | – | `Product[]` |
| DELETE | `/wishlist/:productId` | – | 204 |
| DELETE | `/wishlist` | – | 204 |
| POST | `/wishlist/merge` | `{ productIds }` | `Product[]` |
| GET | `/cart` | – | `{ items: [{ product, qty, option }], count, subtotal }` |
| POST | `/cart/items` | `{ productId, qty?, option? }` (adds to the quantity) | cart |
| PATCH | `/cart/items/:productId` | `{ qty?, option? }` | cart |
| DELETE | `/cart/items/:productId` | – | 204 |
| DELETE | `/cart` | – | 204 |
| POST | `/cart/merge` | `{ items: [{ productId, qty, option? }] }` (larger quantity wins) | cart |

`productId` is the product slug (the `id` the storefront uses). Quantities are 1–99. Items that are sold or unpublished drop out of wishlists and carts automatically. Sellers can't add their own listings to their cart (`OWN_LISTING`).

## Selling

1. **Verify identity** – the seller uploads a photo of their ID (`POST /uploads/...` with purpose `id_document`, stored privately) and sends `POST /seller/verification { idType, documentPublicId }`. Status becomes `pending` and **selling unlocks right away**; an admin reviews it later.
2. **List an item** – `POST /seller/listings` with `status: "draft"` (only a category is needed) or `"active"` (needs title, category, price, at least one photo and a location). Photos must be the seller's own Cloudinary uploads (purpose `listing_photo`).
3. Active listings are normal products: they appear on the home rails (as **New**), in their category, in search and on `/products/:slug` with the seller's name.
4. `PATCH /seller/listings/:id` edits, publishes (`status: "active"`), marks sold (`"sold"`) or moves back to drafts. `DELETE` removes it and its photos.

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/seller/verification` | `none` / `pending` / `verified` / `rejected` |
| GET/POST | `/seller/listings` | my listings, all statuses |
| GET/PATCH/DELETE | `/seller/listings/:id` | owner only |
| GET | `/admin/seller-verifications?status=PENDING` | admin: includes a 1-hour link to the ID photo |
| PATCH | `/admin/seller-verifications/:id` | admin: `{ status: "VERIFIED" | "REJECTED", note? }` |

A rejected seller can't publish until they send their ID again. Verified sellers get the "ID Verified" badge on their product pages.

### Categories

Listings go into the shop's categories (`GET /catalog/categories`). The seed adds Phones & Tablets, Beauty, Groceries, Sports, Jobs & Services and Other to the original five; the home sidebar shows the first five and every category is in the "All categories" menu.

## Delivery addresses

Signed-in users save addresses in their account (`/profile/addresses` on the web).

| Method | Path | Body |
|---|---|---|
| GET | `/addresses` | – |
| POST | `/addresses` | `{ label, name, phone, address, isDefault? }` |
| PATCH | `/addresses/:id` | any of those; `{ isDefault: true }` makes it the default |
| DELETE | `/addresses/:id` | – |

Every call returns the full list, default first. The first address is the default automatically; deleting the default makes the newest remaining address the default. Phone numbers are Nigerian mobiles (any common format, saved as +234…). Up to 20 addresses.

The **default address** is what the website shows in the header (next to the pin), in the cart's shipping address and at checkout. Editing the address on the cart or checkout page updates the default (or saves it as "Home" if there isn't one yet).
