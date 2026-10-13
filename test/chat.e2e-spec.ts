import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./app.factory";

/** Opens GET /chat/events and collects the parsed events (Server-Sent Events). */
async function openStream(baseUrl: string, token: string) {
  const ctrl = new AbortController();
  const res = await fetch(`${baseUrl}/api/v1/chat/events`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
  const events: { type: string; [k: string]: unknown }[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (data) events.push(JSON.parse(data.slice(5)));
        }
      }
    } catch {
      /* aborted */
    }
  })();
  const waitFor = async (pred: (e: { type: string; [k: string]: unknown }) => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const hit = events.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`event not received; got ${JSON.stringify(events)}`);
  };
  return { status: res.status, contentType: res.headers.get("content-type"), events, waitFor, close: () => ctrl.abort() };
}

describe("Chat (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let baseUrl: string;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ({ app, prisma, reset } = await createTestApp());
    await app.listen(0);
    baseUrl = await app.getUrl();
    baseUrl = baseUrl.replace("[::1]", "127.0.0.1");
  });
  afterAll(async () => {
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await app.close();
  });

  let seller: { token: string; id: string };
  let buyer: { token: string; id: string };
  const signIn = async (sub: string) => {
    const res = await api().post("/api/v1/auth/oauth/google").send({ idToken: `ok:${sub}:${sub}@gmail.com` }).expect(200);
    return { token: res.body.accessToken as string, id: res.body.user.id as string };
  };

  beforeEach(async () => {
    await reset();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    seller = await signIn("seller");
    buyer = await signIn("buyer");
    const cat = await prisma.category.create({ data: { slug: "electronics", name: "Electronics", imageUrl: "/e.png" } });
    const base = { categoryId: cat.id, location: "Ikeja, Lagos", imageUrl: "/p.png", gallery: [], variations: [] };
    await prisma.product.createMany({
      data: [
        { ...base, slug: "iphone", name: "iPhone 13", price: 520000, sellerId: seller.id },
        { ...base, slug: "shop-item", name: "Shop item", price: 1000 },
      ],
    });
  });

  it("buyer messages a seller; both see it live; read receipts and unread counts work", async () => {
    const sellerStream = await openStream(baseUrl, seller.token);
    const buyerStream = await openStream(baseUrl, buyer.token);
    expect(sellerStream.status).toBe(200);
    expect(sellerStream.contentType).toContain("text/event-stream");
    await sellerStream.waitFor((e) => e.type === "ping");

    const started = await api().post("/api/v1/chat/conversations").set(bearer(buyer.token)).send({ productId: "iphone", text: "Hi! Is it still available?" }).expect(200);
    expect(started.body).toMatchObject({
      role: "buyer",
      other: { id: seller.id, name: "Romina W." },
      product: { id: "iphone", title: "iPhone 13", price: 520000, status: "active" },
      lastMessage: { text: "Hi! Is it still available?", senderId: buyer.id },
      unread: 0,
    });
    const id = started.body.id;

    // Live to the seller (and to the buyer's other devices).
    const live = await sellerStream.waitFor((e) => e.type === "message");
    expect(live).toMatchObject({ conversationId: id, message: { text: "Hi! Is it still available?" } });
    await buyerStream.waitFor((e) => e.type === "message");

    // Same listing → same conversation.
    const again = await api().post("/api/v1/chat/conversations").set(bearer(buyer.token)).send({ productId: "iphone" }).expect(200);
    expect(again.body.id).toBe(id);

    const sellerInbox = await api().get("/api/v1/chat/conversations").set(bearer(seller.token)).expect(200);
    expect(sellerInbox.body).toHaveLength(1);
    expect(sellerInbox.body[0]).toMatchObject({ role: "seller", other: { id: buyer.id }, unread: 1 });
    expect((await api().get("/api/v1/chat/unread").set(bearer(seller.token))).body).toEqual({ unread: 1 });

    // Seller reads → buyer gets a read receipt.
    await api().post(`/api/v1/chat/conversations/${id}/read`).set(bearer(seller.token)).expect(204);
    await buyerStream.waitFor((e) => e.type === "read" && e.readerId === seller.id);
    expect((await api().get("/api/v1/chat/unread").set(bearer(seller.token))).body).toEqual({ unread: 0 });
    const buyerView = await api().get(`/api/v1/chat/conversations/${id}`).set(bearer(buyer.token)).expect(200);
    expect(buyerView.body.otherLastReadAt).not.toBeNull();

    // Typing goes only to the other person.
    await api().post(`/api/v1/chat/conversations/${id}/typing`).set(bearer(seller.token)).expect(204);
    await buyerStream.waitFor((e) => e.type === "typing");

    // Reply
    const reply = await api().post(`/api/v1/chat/conversations/${id}/messages`).set(bearer(seller.token)).send({ text: "  Yes it is!  " }).expect(201);
    expect(reply.body).toMatchObject({ text: "Yes it is!", senderId: seller.id });
    await buyerStream.waitFor((e) => e.type === "message" && (e.message as { text: string }).text === "Yes it is!");
    expect((await api().get("/api/v1/chat/conversations").set(bearer(buyer.token))).body[0].unread).toBe(1);

    const page = await api().get(`/api/v1/chat/conversations/${id}/messages`).set(bearer(buyer.token)).expect(200);
    expect(page.body.items.map((m: { text: string }) => m.text)).toEqual(["Hi! Is it still available?", "Yes it is!"]);
    expect(page.body.hasMore).toBe(false);
    const older = await api().get(`/api/v1/chat/conversations/${id}/messages?limit=1`).set(bearer(buyer.token)).expect(200);
    expect(older.body).toMatchObject({ hasMore: true, items: [{ text: "Yes it is!" }] });

    sellerStream.close();
    buyerStream.close();
  });

  it("keeps conversations private and validates input", async () => {
    const { body } = await api().post("/api/v1/chat/conversations").set(bearer(buyer.token)).send({ productId: "iphone", text: "Hello" }).expect(200);
    const stranger = await signIn("stranger");
    await api().get(`/api/v1/chat/conversations/${body.id}`).set(bearer(stranger.token)).expect(404);
    await api().post(`/api/v1/chat/conversations/${body.id}/messages`).set(bearer(stranger.token)).send({ text: "hey" }).expect(404);
    await api().get(`/api/v1/chat/conversations/${body.id}/messages`).set(bearer(stranger.token)).expect(404);
    expect((await api().get("/api/v1/chat/conversations").set(bearer(stranger.token))).body).toEqual([]);

    await api().post(`/api/v1/chat/conversations/${body.id}/messages`).set(bearer(buyer.token)).send({ text: "   " }).expect(400);
    await api().post(`/api/v1/chat/conversations/${body.id}/messages`).set(bearer(buyer.token)).send({ text: "x".repeat(2001) }).expect(400);

    expect((await api().post("/api/v1/chat/conversations").set(bearer(seller.token)).send({ productId: "iphone" }).expect(400)).body.code).toBe("OWN_LISTING");
    expect((await api().post("/api/v1/chat/conversations").set(bearer(buyer.token)).send({ productId: "shop-item" }).expect(400)).body.code).toBe("NO_SELLER");
    await api().post("/api/v1/chat/conversations").set(bearer(buyer.token)).send({ productId: "nope" }).expect(404);
    await api().get("/api/v1/chat/events").expect(401);
  });

  it("a conversation the buyer opened but never wrote in stays out of the seller's inbox", async () => {
    await api().post("/api/v1/chat/conversations").set(bearer(buyer.token)).send({ productId: "iphone" }).expect(200);
    expect((await api().get("/api/v1/chat/conversations").set(bearer(seller.token))).body).toEqual([]);
    expect((await api().get("/api/v1/chat/conversations").set(bearer(buyer.token))).body).toHaveLength(1);
  });
});
