import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./app.factory";

/** Double-clicks, retries and parallel requests must never charge twice, skip a stage or bypass limits. */
describe("Concurrency, idempotency & caching (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const delivery = { recipient: "Romina Williams", phone: "09045654356", address: "24 Maple Street, Ikotun, Lagos" };

  let buyer: string;
  let seller: string;

  const signIn = async (sub: string) =>
    (await api().post("/api/v1/auth/oauth/google").send({ idToken: `ok:${sub}:${sub}@gmail.com` }).expect(200)).body.accessToken as string;
  const userId = async (sub: string) => (await prisma.user.findFirstOrThrow({ where: { email: `${sub}@gmail.com` } })).id;
  const fund = async (sub: string, amount: number) => {
    const id = await userId(sub);
    await prisma.wallet.upsert({ where: { userId: id }, create: { userId: id, balance: amount }, update: { balance: amount } });
  };
  const checkoutBody = { ...delivery, paymentMethod: "wallet", shipping: "standard", items: [{ productId: "shoes", qty: 1 }] };
  const balance = async () => (await api().get("/api/v1/wallet").set(bearer(buyer)).expect(200)).body.balance as string;

  beforeAll(async () => {
    ({ app, prisma, reset } = await createTestApp());
  });

  beforeEach(async () => {
    await reset();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    buyer = await signIn("buyer");
    seller = await signIn("seller");
    const cat = await prisma.category.create({ data: { slug: "clothing", name: "Clothing", imageUrl: "/c.png" } });
    await prisma.product.create({
      data: { slug: "shoes", name: "Shoes", price: 17000, location: "Lagos", imageUrl: "/x.png", gallery: [], variations: [], categoryId: cat.id, sellerId: await userId("seller") },
    });
  });

  afterAll(async () => {
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await app.close();
  });

  it("a retried checkout with the same Idempotency-Key replays the first result and charges once", async () => {
    await fund("buyer", 50000);
    const key = { "Idempotency-Key": "checkout-abc12345" };
    const first = await api().post("/api/v1/orders/checkout").set(bearer(buyer)).set(key).send(checkoutBody).expect(201);
    const again = await api().post("/api/v1/orders/checkout").set(bearer(buyer)).set(key).send(checkoutBody).expect(201);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.body.payment.reference).toBe(first.body.payment.reference);
    expect(await prisma.order.count()).toBe(1);
    expect(await balance()).toBe("33000.00");
  });

  it("refuses to reuse a key for a different request", async () => {
    await fund("buyer", 50000);
    const key = { "Idempotency-Key": "checkout-def12345" };
    await api().post("/api/v1/orders/checkout").set(bearer(buyer)).set(key).send(checkoutBody).expect(201);
    const other = await api().post("/api/v1/orders/checkout").set(bearer(buyer)).set(key).send({ ...checkoutBody, shipping: "express" }).expect(422);
    expect(other.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("parallel checkouts with money for only one never overspend", async () => {
    await fund("buyer", 17000);
    const results = await Promise.all(Array.from({ length: 6 }, () => api().post("/api/v1/orders/checkout").set(bearer(buyer)).send(checkoutBody)));
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 201)) expect(["CHECKOUT_IN_PROGRESS", "INSUFFICIENT_FUNDS"]).toContain(r.body.code);
    expect(await prisma.order.count()).toBe(1);
    expect(await balance()).toBe("0.00");
  });

  it("a double-click on 'mark as next stage' moves the order only one step", async () => {
    await fund("buyer", 17000);
    const { body } = await api().post("/api/v1/orders/checkout").set(bearer(buyer)).send(checkoutBody).expect(201);
    const id = body.orders[0].id as string;
    const results = await Promise.all([0, 1, 2].map(() => api().post(`/api/v1/orders/${id}/advance`).set(bearer(seller)).send({ fromStage: 0 })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).stage).toBe(1);
    const stale = await api().post(`/api/v1/orders/${id}/advance`).set(bearer(seller)).send({ fromStage: 0 }).expect(409);
    expect(stale.body.code).toBe("ORDER_CHANGED");
  });

  it("parallel cancels refund exactly once", async () => {
    await fund("buyer", 17000);
    const { body } = await api().post("/api/v1/orders/checkout").set(bearer(buyer)).send(checkoutBody).expect(201);
    const id = body.orders[0].id as string;
    const results = await Promise.all([0, 1, 2, 3].map(() => api().post(`/api/v1/orders/${id}/cancel`).set(bearer(buyer))));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await balance()).toBe("17000.00");
  });

  it("parallel wrong OTP guesses can't get more than the allowed attempts", async () => {
    const phone = "09045654356";
    await api().post("/api/v1/auth/register").send({ firstName: "Ada", lastName: "Obi", email: "ada@example.com", phone, password: "Gbanjo2026" }).expect(201);
    const guesses = await Promise.all(Array.from({ length: 8 }, () => api().post("/api/v1/auth/verify-phone").send({ phone, code: "9999" })));
    expect(guesses.filter((g) => g.body.code === "INVALID_CODE").length).toBeLessThanOrEqual(4);
    const after = await api().post("/api/v1/auth/verify-phone").send({ phone, code: "1234" });
    expect(after.status).not.toBe(200);
  });

  it("caches storefront pages and refreshes them when a listing changes", async () => {
    const first = await api().get("/api/v1/products").expect(200);
    expect(first.headers["x-cache"]).toBe("MISS");
    const second = await api().get("/api/v1/products").expect(200);
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(second.headers["content-type"]).toContain("application/json");
    expect(second.body.total).toBe(first.body.total);

    await prisma.product.update({ where: { slug: "shoes" }, data: { name: "Renamed shoes" } });
    await api().delete("/api/v1/seller/listings/does-not-exist").set(bearer(seller)); // a failed change doesn't clear it
    expect((await api().get("/api/v1/products").expect(200)).headers["x-cache"]).toBe("HIT");

    await prisma.sellerVerification.create({ data: { userId: await userId("seller"), idType: "nin", status: "VERIFIED" } });
    const shoes = await prisma.product.findUniqueOrThrow({ where: { slug: "shoes" } });
    const del = await api().delete(`/api/v1/seller/listings/${shoes.id}`).set(bearer(seller));
    expect(del.status).toBeLessThan(300);
    const fresh = await api().get("/api/v1/products").expect(200);
    expect(fresh.headers["x-cache"]).toBe("MISS");
    expect(fresh.body.total).toBe(0);
  });
});
