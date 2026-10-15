# Orders, payments and the wallet

## How a purchase works

1. The website or app calls `POST /api/v1/orders/checkout` with the delivery choice (`standard` free, 5–7 days, or `express` ₦12,000, 1–2 days), the payment method and an optional voucher. With no `items`, it buys the whole cart. Prices always come from the database.
2. The checkout makes **one order per seller**. All of them are paid by **one payment**. Express delivery is charged once, on the first order.
3. How the payment works:
   - **Wallet:** paid straight away. The orders go live and the bought items leave the cart.
   - **Card, bank transfer or USSD:** the response has `payment.checkoutUrl`, a Flutterwave payment page. The orders stay hidden until the payment is confirmed.
4. Flutterwave sends the shopper to `GET /api/v1/payments/flutterwave/return`. We **check the payment with Flutterwave's verify API**: it must be successful, for the right amount and in the right currency. Then we forward the shopper to the `returnUrl` the client gave, with `?reference=…&status=successful|failed|canceled` added.
5. The webhook (`POST /api/v1/payments/flutterwave/webhook`) is a second route to the same check. A background check also runs every 10 minutes. If a payment arrives from more than one of these routes, it is still only counted once.

## The life of an order

| Stage | Name | Who moves it |
|---|---|---|
| 0 | Order confirmed | (paid) |
| 1 | Packed | seller |
| 2 | Shipped | seller |
| 3 | Out for delivery | seller |
| 4 | Delivered → order completed | seller |

- **Moving an order on:** `POST /orders/:id/advance`. An admin moves the orders for items Gbanjo sells itself, which have no seller.
- **Cancelling:** `POST /orders/:id/cancel`. The buyer or the seller can cancel until the order is **Shipped**. An admin can cancel until it is delivered.
- **Refunds:** wallet payments go back to the wallet straight away. Card payments are refunded through Flutterwave. If Flutterwave refuses, the money goes to the wallet instead. `refundTo` on the order says which happened.
- **Seller earnings:** on delivery, the seller's earnings (item price minus `PLATFORM_FEE_PERCENT`) are **held for `ORDER_PAYOUT_HOLD_DAYS`** (3 by default). This leaves time to sort out problems. After that they move into the seller's wallet balance. `GET /wallet` shows the held amount as `pending`.
- **Emails and texts:**
  - The buyer gets a receipt, plus updates when the order ships, goes out for delivery (also by SMS) and is delivered.
  - The seller gets an email and an SMS for each new order.
  - Both sides hear when an order is canceled.

## Wallet top-ups

`POST /api/v1/payments/top-up {amount, method?, returnUrl}` accepts ₦1,000–₦500,000 and returns a `checkoutUrl`. After payment, the money is added to the wallet and a receipt is emailed. `GET /wallet/transactions` lists all wallet activity.

## Vouchers

`POST /vouchers/check {code}` checks a code. Checkout then applies it as a percentage off the items. The codes are stored in the `vouchers` table: GBANJO10 (10% off) and WELCOME5 (5% off) are there to start. Add or remove codes in the database, for example with Prisma Studio.

## Setting up Flutterwave

1. In the Flutterwave dashboard, go to **Settings → API keys** and copy the **Secret key**. Set it as `FLW_SECRET_KEY` on Render. Use the test key until you're ready for real payments.
2. Go to **Settings → Webhooks**:
   - URL: `https://gbanjo-backend.onrender.com/api/v1/payments/flutterwave/webhook`
   - Secret hash: any long random text. Put the same text in `FLW_SECRET_HASH`.
3. `API_PUBLIC_URL` is where Flutterwave sends shoppers back. On Render it defaults to the service URL. Set it if you use your own domain for the API.
4. The website's address must be in `CORS_ORIGINS` (or in `PAYMENT_RETURN_ORIGINS`). The app's `gbanjo://` and `exp://` links are always allowed.

**Without `FLW_SECRET_KEY`:**
- In development, card payments open a built-in **test payment page** at `/api/v1/payments/test-checkout/:reference` with Pay, Decline and Cancel buttons. No money moves.
- In production, card payments answer `PAYMENTS_NOT_CONFIGURED`. Wallet payments still work.

## Error codes

| Code | When |
|---|---|
| `CART_EMPTY` | Nothing to buy |
| `ITEMS_UNAVAILABLE` | Something was sold or removed (`details.items` lists the slugs) |
| `OWN_LISTING` | Buying your own listing |
| `ADDRESS_REQUIRED` / `INVALID_PHONE` | Delivery details missing or wrong |
| `INVALID_VOUCHER` | Unknown or expired code |
| `INSUFFICIENT_FUNDS` (402) | Not enough in the wallet |
| `INVALID_RETURN_URL` | Return link isn't the website or the app |
| `PAYMENTS_NOT_CONFIGURED` (503) | No Flutterwave key in production |
| `PAYMENT_PROVIDER_ERROR` (502) | Flutterwave couldn't be reached or refused |
| `CANT_CANCEL` / `CANT_UPDATE_ORDER` / `ORDER_CHANGED` | The order has moved on |
