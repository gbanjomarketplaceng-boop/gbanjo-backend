# Live chat (buyer ↔ seller)

A buyer taps **Message** on a seller's listing; that opens (or reuses) one conversation per buyer per listing. Both people see new messages, read receipts and "typing…" instantly.

## How it's built

- **Data:** `conversations` (product, buyer, seller, last-read times) and `chat_messages`.
- **REST** for everything that changes data (see Swagger → Chat).
- **Live updates:** `GET /api/v1/chat/events` is a Server-Sent Events stream (needs the Bearer token). Each event's `data` is JSON:
  - `{ type: "message", conversationId, message }` – new message (also your own, so other devices stay in sync)
  - `{ type: "read", conversationId, readerId, readAt }` – read receipt
  - `{ type: "typing", conversationId, userId }` – the other person is typing (show for ~4 s)
  - `{ type: "ping" }` – heartbeat every 25 s
- **Multiple servers:** events go through Redis pub/sub (`chat:events`), so it works with several API instances behind a load balancer.

| Method | Path | |
|---|---|---|
| GET | `/chat/events` | live stream |
| GET | `/chat/conversations` | my inbox (as buyer and seller), newest first, with unread counts |
| GET | `/chat/unread` | `{ unread }` for a badge |
| POST | `/chat/conversations` | `{ productId, text? }` message the seller of a listing |
| GET | `/chat/conversations/:id` | one conversation |
| GET | `/chat/conversations/:id/messages?before=&limit=` | messages, oldest first; `before` loads older ones |
| POST | `/chat/conversations/:id/messages` | `{ text }` (1–2000 chars, 30/min) |
| POST | `/chat/conversations/:id/read` | mark read → the other side sees "Read" |
| POST | `/chat/conversations/:id/typing` | at most every few seconds |

Rules: only the two people in a conversation can see it; you can't message yourself about your own listing; shop items without a seller can't be messaged. A conversation the buyer opened but never wrote in doesn't show in the seller's inbox.

## Website

The browser connects to `/api/chat/events` (a Next.js route that opens the API stream with the user's token from the httpOnly cookie, so the token never reaches the page). It reconnects automatically with back-off and catches up on anything missed.

## Mobile

Use any SSE client (e.g. `react-native-sse`) with `Authorization: Bearer <accessToken>`, reconnect when it drops or the token is refreshed, and call the REST endpoints for everything else.

## Not included yet

Photo/file attachments in chat, push notifications or emails for messages received while offline, blocking/reporting users.
