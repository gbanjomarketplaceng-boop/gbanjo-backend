import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./app.factory";

describe("Notifications, reports, blocking, withdrawals, account deletion & admin (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const delivery = { recipient: "Ada Obi", phone: "08031234567", address: "3 Allen Avenue, Ikeja" };

  const signIn = async (sub: string) => {
    const res = await api().post("/api/v1/auth/oauth/google").send({ idToken: `ok:${sub}:${sub}@gmail.com` }).expect(200);
    return { token: res.body.accessToken as string, id: res.body.user.id as string };
  };
  /** Email + password account (for the password check when deleting). */
  const signUp = async (email: string, phone: string) => {
    await api().post("/api/v1/auth/register").send({ firstName: "Tola", lastName: "Ade", email, phone, password: "Gbanjo2026" }).expect(201);
    const res = await api().post("/api/v1/auth/verify-phone").send({ phone, code: "1234" }).expect(200);
    return { token: res.body.accessToken as string, id: res.body.user.id as string };
  };
  const makeAdmin = async (sub: string) => {
    const u = await signIn(sub);
    await prisma.user.update({ where: { id: u.id }, data: { role: "ADMIN" } });
    return signIn(sub);
  };
  const fund = async (userId: string, amount: number) => {
    const w = await prisma.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
    await prisma.wallet.update({ where: { id: w.id }, data: { balance: amount } });
  };

  let seller: { token: string; id: string };
  let buyer: { token: string; id: string };

  beforeAll(async () => {
    ({ app, prisma, reset } = await createTestApp());
  });

  beforeEach(async () => {
    await reset();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    seller = await signIn("seller");
    buyer = await signIn("buyer");
    const cat = await prisma.category.create({ data: { slug: "clothing", name: "Clothing", imageUrl: "/c.png" } });
    await prisma.product.create({ data: { slug: "shoes", name: "Shoes", price: 17000, location: "Lagos", imageUrl: "/x.png", gallery: [], variations: [], categoryId: cat.id, sellerId: seller.id } });
    await prisma.sellerVerification.create({ data: { userId: seller.id, idType: "nin", status: "VERIFIED" } });
  });

  afterAll(async () => {
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await app.close();
  });

  describe("notifications", () => {
    it("buyer and seller are notified about an order; read state and unread count", async () => {
      await fund(buyer.id, 50000);
      const res = await api().post("/api/v1/orders/checkout").set(bearer(buyer.token)).send({ shipping: "standard", paymentMethod: "wallet", items: [{ productId: "shoes", qty: 1 }], ...delivery }).expect(201);
      const id = res.body.orders[0].id;

      const mine = (await api().get("/api/v1/notifications").set(bearer(buyer.token)).expect(200)).body;
      expect(mine).toMatchObject({ unread: 1, hasMore: false, items: [{ type: "order", title: `Order #${id} confirmed`, href: `/orders/${id}`, read: false }] });
      const theirs = (await api().get("/api/v1/notifications").set(bearer(seller.token)).expect(200)).body;
      expect(theirs.items[0]).toMatchObject({ title: `New order #${id}`, href: `/orders/${id}` });

      for (let i = 0; i < 2; i++) await api().post(`/api/v1/orders/${id}/advance`).set(bearer(seller.token)).expect(200);
      expect((await api().get("/api/v1/notifications/unread").set(bearer(buyer.token)).expect(200)).body).toEqual({ unread: 2 });

      const first = mine.items[0].id;
      expect((await api().post("/api/v1/notifications/read").set(bearer(buyer.token)).send({ ids: [first] }).expect(200)).body).toEqual({ unread: 1 });
      expect((await api().post("/api/v1/notifications/read").set(bearer(buyer.token)).send({}).expect(200)).body).toEqual({ unread: 0 });
      await api().get("/api/v1/notifications").expect(401);
    });

    it("seller ID decisions are notified", async () => {
      const admin = await makeAdmin("admin");
      const other = await signIn("newseller");
      const v = await prisma.sellerVerification.create({ data: { userId: other.id, idType: "nin" } });
      await api().patch(`/api/v1/admin/seller-verifications/${v.id}`).set(bearer(admin.token)).send({ status: "REJECTED", note: "Blurry photo" }).expect(200);
      const n = (await api().get("/api/v1/notifications").set(bearer(other.token)).expect(200)).body.items[0];
      expect(n).toMatchObject({ type: "seller", title: "We couldn't verify your ID", href: "/sell/verify" });
      expect(n.body).toContain("Blurry photo");
    });

    it("settings: defaults, partial updates; push tokens are validated", async () => {
      expect((await api().get("/api/v1/notifications/preferences").set(bearer(buyer.token)).expect(200)).body).toEqual({
        orderUpdates: true,
        messages: true,
        offers: false,
        personalised: true,
        analytics: true,
      });
      const p = (await api().patch("/api/v1/notifications/preferences").set(bearer(buyer.token)).send({ offers: true, messages: false }).expect(200)).body;
      expect(p).toMatchObject({ offers: true, messages: false, orderUpdates: true });
      await api().patch("/api/v1/notifications/preferences").set(bearer(buyer.token)).send({ offers: "yes" }).expect(400);

      await api().put("/api/v1/notifications/push-token").set(bearer(buyer.token)).send({ token: "not-a-token" }).expect(400);
      await api().put("/api/v1/notifications/push-token").set(bearer(buyer.token)).send({ token: "ExponentPushToken[abc123]", platform: "ios" }).expect(204);
      // The same phone signing in as someone else moves the token to them.
      await api().put("/api/v1/notifications/push-token").set(bearer(seller.token)).send({ token: "ExponentPushToken[abc123]" }).expect(204);
      expect(await prisma.pushToken.findUnique({ where: { token: "ExponentPushToken[abc123]" } })).toMatchObject({ userId: seller.id });
      await api().delete("/api/v1/notifications/push-token").set(bearer(seller.token)).send({ token: "ExponentPushToken[abc123]" }).expect(204);
      expect(await prisma.pushToken.count()).toBe(0);
    });
  });

  describe("reports, admin take-down and blocking", () => {
    it("reports a listing once; admin hides it and the seller can't republish", async () => {
      const r1 = await api().post("/api/v1/reports").set(bearer(buyer.token)).send({ type: "product", id: "shoes", reason: "fake", details: "Not original" }).expect(201);
      const r2 = await api().post("/api/v1/reports").set(bearer(buyer.token)).send({ type: "product", id: "shoes", reason: "scam" }).expect(201);
      expect(r2.body.id).toBe(r1.body.id);
      await api().post("/api/v1/reports").set(bearer(seller.token)).send({ type: "product", id: "shoes", reason: "fake" }).expect(400);
      await api().post("/api/v1/reports").set(bearer(buyer.token)).send({ type: "product", id: "shoes", reason: "because" }).expect(400);
      await api().post("/api/v1/reports").set(bearer(buyer.token)).send({ type: "user", id: buyer.id, reason: "other" }).expect(400);

      const admin = await makeAdmin("admin");
      await api().get("/api/v1/admin/reports").set(bearer(buyer.token)).expect(403);
      const list = (await api().get("/api/v1/admin/reports?status=open").set(bearer(admin.token)).expect(200)).body;
      expect(list).toEqual([expect.objectContaining({ id: r1.body.id, type: "product", reason: "scam", product: expect.objectContaining({ id: "shoes", status: "active" }), user: expect.objectContaining({ id: seller.id }) })]);

      await api().patch("/api/v1/admin/products/shoes").set(bearer(admin.token)).send({ status: "hidden" }).expect(200);
      await api().get("/api/v1/products/shoes").expect(404);
      const listing = await prisma.product.findUniqueOrThrow({ where: { slug: "shoes" } });
      const re = await api().patch(`/api/v1/seller/listings/${listing.id}`).set(bearer(seller.token)).send({ status: "active" }).expect(403);
      expect(re.body.code).toBe("LISTING_REMOVED");
      expect((await api().get("/api/v1/notifications").set(bearer(seller.token)).expect(200)).body.items[0].title).toBe("A listing was taken down");

      const done = (await api().patch(`/api/v1/admin/reports/${r1.body.id}`).set(bearer(admin.token)).send({ status: "resolved", note: "Listing removed" }).expect(200)).body;
      expect(done).toMatchObject({ status: "resolved", note: "Listing removed" });
      expect((await api().get("/api/v1/admin/overview").set(bearer(admin.token)).expect(200)).body).toMatchObject({ openReports: 0 });
    });

    it("blocking stops messages both ways until unblocked", async () => {
      const c = (await api().post("/api/v1/chat/conversations").set(bearer(buyer.token)).send({ productId: "shoes", text: "Still available?" }).expect(200)).body;
      expect(c).toMatchObject({ blockedByMe: false, blockedMe: false });

      await api().put(`/api/v1/blocks/${buyer.id}`).set(bearer(seller.token)).expect(204);
      expect((await api().get("/api/v1/blocks").set(bearer(seller.token)).expect(200)).body).toEqual([expect.objectContaining({ id: buyer.id })]);
      const no = await api().post(`/api/v1/chat/conversations/${c.id}/messages`).set(bearer(buyer.token)).send({ text: "Hello?" }).expect(403);
      expect(no.body.code).toBe("BLOCKED");
      await api().post(`/api/v1/chat/conversations/${c.id}/messages`).set(bearer(seller.token)).send({ text: "Hi" }).expect(403);
      expect((await api().get(`/api/v1/chat/conversations/${c.id}`).set(bearer(buyer.token)).expect(200)).body).toMatchObject({ blockedMe: true, blockedByMe: false });
      expect((await api().get("/api/v1/chat/conversations").set(bearer(seller.token)).expect(200)).body[0]).toMatchObject({ blockedByMe: true });

      await api().delete(`/api/v1/blocks/${buyer.id}`).set(bearer(seller.token)).expect(204);
      await api().post(`/api/v1/chat/conversations/${c.id}/messages`).set(bearer(buyer.token)).send({ text: "Hello?" }).expect(201);
      await api().put(`/api/v1/blocks/${seller.id}`).set(bearer(seller.token)).expect(400);
    });
  });

  describe("withdrawals", () => {
    it("saves a checked bank account, sends money, and refunds a failed transfer", async () => {
      const banks = (await api().get("/api/v1/wallet/banks").set(bearer(seller.token)).expect(200)).body;
      expect(banks).toEqual(expect.arrayContaining([{ code: "044", name: "Access Bank" }]));
      expect((await api().get("/api/v1/wallet/bank-account").set(bearer(seller.token)).expect(200)).body).toEqual({});

      await api().post("/api/v1/wallet/withdrawals").set(bearer(seller.token)).send({ amount: 5000 }).expect(400);
      const bad = await api().put("/api/v1/wallet/bank-account").set(bearer(seller.token)).send({ bankCode: "044", accountNumber: "0123459999" }).expect(400);
      expect(bad.body.code).toBe("ACCOUNT_NOT_FOUND");
      await api().put("/api/v1/wallet/bank-account").set(bearer(seller.token)).send({ bankCode: "000", accountNumber: "0123456789" }).expect(400);
      await api().put("/api/v1/wallet/bank-account").set(bearer(seller.token)).send({ bankCode: "044", accountNumber: "12345" }).expect(400);
      const acct = (await api().put("/api/v1/wallet/bank-account").set(bearer(seller.token)).send({ bankCode: "044", accountNumber: "0123456789" }).expect(200)).body;
      expect(acct).toEqual({ bankCode: "044", bankName: "Access Bank", accountNumber: "0123456789", accountName: "TEST ACCOUNT 6789" });

      await fund(seller.id, 20000);
      const tooMuch = await api().post("/api/v1/wallet/withdrawals").set(bearer(seller.token)).send({ amount: 50000 }).expect(400);
      expect(tooMuch.body).toMatchObject({ code: "INSUFFICIENT_FUNDS", message: "You can withdraw up to ₦20,000." });
      await api().post("/api/v1/wallet/withdrawals").set(bearer(seller.token)).send({ amount: 500 }).expect(400);

      const ok = (await api().post("/api/v1/wallet/withdrawals").set(bearer(seller.token)).send({ amount: 15000 }).expect(201)).body;
      expect(ok).toMatchObject({ amount: 15000, status: "successful", bankName: "Access Bank", accountNumber: "******6789", accountName: "TEST ACCOUNT 6789" });
      expect((await api().get("/api/v1/wallet").set(bearer(seller.token)).expect(200)).body.balance).toBe("5000.00");

      // A bank that rejects the transfer: the money comes back.
      await api().put("/api/v1/wallet/bank-account").set(bearer(seller.token)).send({ bankCode: "058", accountNumber: "0123450000" }).expect(200);
      const failed = (await api().post("/api/v1/wallet/withdrawals").set(bearer(seller.token)).send({ amount: 5000 }).expect(201)).body;
      expect(failed).toMatchObject({ status: "failed", failureReason: "Test: the bank rejected this account" });
      expect((await api().get("/api/v1/wallet").set(bearer(seller.token)).expect(200)).body.balance).toBe("5000.00");

      expect((await api().get("/api/v1/wallet/withdrawals").set(bearer(seller.token)).expect(200)).body.map((w: { status: string }) => w.status)).toEqual(["failed", "successful"]);
      const tx = (await api().get("/api/v1/wallet/transactions").set(bearer(seller.token)).expect(200)).body;
      expect(tx.filter((t: { type: string }) => t.type === "withdrawal").map((t: { amount: number }) => t.amount)).toEqual([5000, -5000, -15000]);
      const notes = (await api().get("/api/v1/notifications").set(bearer(seller.token)).expect(200)).body.items.map((n: { title: string }) => n.title);
      expect(notes).toEqual(expect.arrayContaining(["₦15,000 sent to your bank", "Withdrawal didn't go through"]));

      const admin = await makeAdmin("admin");
      expect((await api().get("/api/v1/admin/withdrawals").set(bearer(admin.token)).expect(200)).body).toHaveLength(2);
    });
  });

  describe("account deletion", () => {
    it("needs the password, an empty wallet and no open orders; then the account is gone", async () => {
      const me = await signUp("tola@example.com", "08035550001");
      await api().delete("/api/v1/users/me").set(bearer(me.token)).send({ password: "wrong-pass1" }).expect(400);

      await fund(me.id, 20000);
      const wallet = await api().delete("/api/v1/users/me").set(bearer(me.token)).send({ password: "Gbanjo2026" }).expect(409);
      expect(wallet.body.code).toBe("WALLET_NOT_EMPTY");

      const order = (await api().post("/api/v1/orders/checkout").set(bearer(me.token)).send({ shipping: "standard", paymentMethod: "wallet", items: [{ productId: "shoes", qty: 1 }], ...delivery }).expect(201)).body;
      const open = await api().delete("/api/v1/users/me").set(bearer(me.token)).send({ password: "Gbanjo2026" }).expect(409);
      expect(open.body.code).toBe("HAS_OPEN_ORDERS");
      await api().post(`/api/v1/orders/${order.orders[0].id}/cancel`).set(bearer(me.token)).expect(200);
      await fund(me.id, 0);

      await api().delete("/api/v1/users/me").set(bearer(me.token)).send({ password: "Gbanjo2026" }).expect(204);
      await api().get("/api/v1/users/me").set(bearer(me.token)).expect(401);
      await api().post("/api/v1/auth/login").send({ email: "tola@example.com", password: "Gbanjo2026" }).expect(401);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
      expect(row).toMatchObject({ status: "DELETED", firstName: "Deleted", phone: null, passwordHash: null });
      // The seller still sees the (canceled) order, with a deleted buyer.
      expect((await api().get(`/api/v1/orders/${order.orders[0].id}`).set(bearer(seller.token)).expect(200)).body.buyer.name).toBe("Deleted user");
      // The email and phone can be used for a new account.
      await signUp("tola@example.com", "08035550001");
    });

    it("Google accounts confirm by typing DELETE", async () => {
      const g = await signIn("gone");
      await api().delete("/api/v1/users/me").set(bearer(g.token)).send({}).expect(400);
      await api().delete("/api/v1/users/me").set(bearer(g.token)).send({ confirm: "delete" }).expect(204);
      // Signing in with Google again makes a brand-new account.
      const again = await signIn("gone");
      expect(again.id).not.toBe(g.id);
    });
  });

  describe("admin people", () => {
    it("finds, suspends and reactivates people", async () => {
      const admin = await makeAdmin("admin");
      await api().get("/api/v1/admin/users").set(bearer(seller.token)).expect(403);
      const found = (await api().get("/api/v1/admin/users?q=seller@gmail").set(bearer(admin.token)).expect(200)).body;
      expect(found).toEqual([expect.objectContaining({ id: seller.id, seller: "verified", listings: 1, status: "active" })]);

      await api().patch(`/api/v1/admin/users/${admin.id}`).set(bearer(admin.token)).send({ status: "suspended" }).expect(400);
      expect((await api().patch(`/api/v1/admin/users/${seller.id}`).set(bearer(admin.token)).send({ status: "suspended" }).expect(200)).body.status).toBe("suspended");
      await api().get("/api/v1/users/me").set(bearer(seller.token)).expect(401);
      const blocked = await api().post("/api/v1/auth/oauth/google").send({ idToken: "ok:seller:seller@gmail.com" }).expect(403);
      expect(blocked.body.code).toBe("ACCOUNT_SUSPENDED");
      await api().patch(`/api/v1/admin/users/${seller.id}`).set(bearer(admin.token)).send({ status: "active" }).expect(200);
      await signIn("seller");

      expect((await api().get("/api/v1/admin/overview").set(bearer(admin.token)).expect(200)).body).toEqual({
        users: 3,
        pendingVerifications: 0,
        openReports: 0,
        newContactMessages: 0,
        ongoingOrders: 0,
        pendingWithdrawals: 0,
      });
    });
  });
});
