# Notifications, withdrawals, reports & blocking, account deletion, admin

## Notifications (`/api/v1/notifications`)
- `GET /notifications` lists your notifications (newest first, with the `unread` count). `GET /notifications/unread` returns just the count, and `POST /notifications/read {ids?}` marks them read (all of them if you leave out `ids`).
- **When notifications are created:**
  - **Orders:** the buyer hears when an order is paid, shipped, out for delivery, delivered or canceled. The seller hears about each new order and about cancellations.
  - **Wallet:** top-ups and withdrawals (sent or failed).
  - **Selling:** seller ID approved or rejected, and listings taken down.
  - **Chat:** new messages get a phone push only. Chats keep their own unread counts, so they don't go in the list.
- `href` is the same path on the website and in the app, e.g. `/orders/92287157`, `/messages/<id>`, `/profile/wallet/history`.
- **Phone pushes:**
  - The app saves its Expo token with `PUT /notifications/push-token {token, platform}` and removes it on sign-out.
  - Pushes go through Expo's push service; tokens for uninstalled apps are deleted automatically.
  - Set `EXPO_ACCESS_TOKEN` only if "Enhanced push security" is on for your Expo project.
- **Settings:** `GET/PATCH /notifications/preferences` covers `orderUpdates`, `messages`, `offers`, `personalised` and `analytics`.
  - `orderUpdates` turns off order, payment and withdrawal pushes, and the shipping-update emails. Receipts are always sent.
  - `messages` turns off chat pushes.

## Withdrawals (`/api/v1/wallet/...`)
1. `GET /wallet/banks` lists the Nigerian banks.
2. `PUT /wallet/bank-account {bankCode, accountNumber}`: Flutterwave confirms the account name with the bank, and the account is saved. Saving again replaces it.
3. `POST /wallet/withdrawals {amount}`: the wallet is debited at once and a Flutterwave transfer starts. The amount must be at least `WITHDRAWAL_MIN`.
   - If the transfer **fails**, the money goes back to the wallet automatically.
   - The final result comes from Flutterwave: its reply, the `transfer.completed` webhook (same webhook URL as payments), or a check every 5 minutes.
4. `GET /wallet/withdrawals` lists past withdrawals. Account numbers show only the last 4 digits.

**Flutterwave setup:**
- Turn on **Transfers** for your account.
- Keep money in your Flutterwave NGN balance so transfers can be paid.
- Allow-list your server's IP addresses if Flutterwave asks you to.

**Without `FLW_SECRET_KEY` (development only):**
- Transfers succeed at once.
- Account numbers ending `0000` fail, so you can try the refund path.
- Numbers ending `9999` don't resolve.

## Reports & blocking
- `POST /reports {type: product|user, id, reason: scam|fake|prohibited|offensive|other, details?}` creates a report. Reporting the same thing again updates your open report.
- `PUT /blocks/:userId` blocks someone and `DELETE /blocks/:userId` unblocks them. `GET /blocks` lists who you've blocked.
- While either person has blocked the other, neither can message the other. Conversations include `blockedByMe` and `blockedMe`.

## Deleting an account (`DELETE /api/v1/users/me`)
- **Confirming:** accounts with a password send `{password}`. Google/Apple accounts send `{confirm: "DELETE"}`.
- **Refused** with `HAS_OPEN_ORDERS`, `WALLET_NOT_EMPTY` (withdraw first) or `WITHDRAWAL_IN_PROGRESS`.
- **What happens:**
  - Name, email, phone, photo, password, addresses, cart, wishlist, saved bank account, notifications and sign-ins are removed.
  - Listings are taken down.
  - Orders other people are part of stay, showing "Deleted user".
  - The email and phone number can be used again for a new account.

## Admin (`/api/v1/admin/...`, role ADMIN)
| Endpoint | What |
|---|---|
| `GET overview` | Counts for the dashboard: people, IDs to review, open reports, new contact messages, ongoing orders, withdrawals in progress |
| `GET users?q=&status=` · `PATCH users/:id {status}` | Find people. Suspending signs them out everywhere and stops sign-in. |
| `GET reports?status=` · `PATCH reports/:id {status, note}` | Reported listings and people |
| `PATCH products/:slug {status: hidden\|active}` | Take a listing down. The seller is told and can't republish it. |
| `GET withdrawals?status=` | All withdrawals |
| Existing | `seller-verifications`, `contact-messages`, `orders`, `banners`, `reviews/:id` |
