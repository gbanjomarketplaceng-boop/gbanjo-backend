import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./app.factory";

process.env.FLW_SECRET_HASH = "test-webhook-hash";

describe("Orders, payments & wallet (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const RETURN = "http://localhost:3000/checkout/complete";
  const delivery = { recipient: "Romina Williams", phone: "09045654356", address: "24 Maple Street, Ikotun, Lagos" };

  let buyer: string;
  let seller: string;
  let seller2: string;

  const signIn = async (sub: string) =>
    (await api().post("/api/v1/auth/oauth/google").send({ idToken: `ok:${sub}:${sub}@gmail.com` }).expect(200)).body.accessToken as string;
  const userId = async (sub: string) => (await prisma.user.findFirstOrThrow({ where: { email: `${sub}@gmail.com` } })).id;
  const balance = async (t: string) => (await api().get("/api/v1/wallet").set(bearer(t)).expect(200)).body;
  const path = (url: string) => {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  };

  /** Plays the test checkout page: press a button, then follow Flutterwave's redirect back to us. */
  const pay = async (checkoutUrl: string, status: "successful" | "failed" | "cancelled" = "successful") => {
    const page = await api().get(path(checkoutUrl)).expect(200);
    expect(page.text).toContain("Test payment");
    const posted = await api().post(path(checkoutUrl)).type("form").send({ status }).expect(303);
    const back = await api().get(path(posted.headers.location)).expect(302);
    return new URL(back.headers.location);
  };

  const topUp = async (t: string, amount: number) => {
    const res = await api().post("/api/v1/payments/top-up").set(bearer(t)).send({ amount, returnUrl: "http://localhost:3000/profile/wallet/success?amount=" + amount }).expect(201);
    return pay(res.body.checkoutUrl);
  };

  beforeAll(async () => {
    ({ app, prisma, reset } = await createTestApp());
  });

  beforeEach(async () => {
    await reset();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    buyer = await signIn("buyer");
    seller = await signIn("seller");
    seller2 = await signIn("seller2");
    const cat = await prisma.category.create({ data: { slug: "clothing", name: "Clothing", imageUrl: "/c.png" } });
    const base = { location: "Lagos", imageUrl: "/x.png", gallery: [], variations: [], categoryId: cat.id };
    await prisma.product.createMany({
      data: [
        { ...base, slug: "shoes", name: "Shoes", price: 17000, sellerId: await userId("seller") },
        { ...base, slug: "bag", name: "Bag", price: 8000, sellerId: await userId("seller2") },
        { ...base, slug: "house-shirt", name: "Gbanjo Shirt", price: 5000 },
        { ...base, slug: "gone", name: "Gone", price: 100, status: "SOLD", sellerId: await userId("seller") },
      ],
    });
  });

  afterAll(async () => {
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await app.close();
  });

  it("tops up the wallet through the payment page, once", async () => {
    const back = await topUp(buyer, 5000);
    expect(back.origin + back.pathname).toBe("http://localhost:3000/profile/wallet/success");
    expect(back.searchParams.get("status")).toBe("successful");
    expect(back.searchParams.get("amount")).toBe("5000");
    const ref = back.searchParams.get("reference")!;
    expect((await balance(buyer)).balance).toBe("5000.00");

    // A second redirect / webhook / check for the same payment changes nothing.
    await api().get(`/api/v1/payments/flutterwave/return?tx_ref=${ref}&status=successful&transaction_id=test-${ref}`).expect(302);
    await api().post("/api/v1/payments/flutterwave/webhook").set("verif-hash", "test-webhook-hash").send({ event: "charge.completed", data: { id: 1, tx_ref: ref } }).expect(200);
    const p = await api().post(`/api/v1/payments/${ref}/verify`).set(bearer(buyer)).send({}).expect(200);
    expect(p.body).toMatchObject({ reference: ref, purpose: "top-up", status: "successful", amount: 5000 });
    expect((await balance(buyer)).balance).toBe("5000.00");

    const tx = await api().get("/api/v1/wallet/transactions").set(bearer(buyer)).expect(200);
    expect(tx.body).toEqual([expect.objectContaining({ type: "top-up", amount: 5000, status: "completed" })]);
  });

  it("validates top-ups and return links", async () => {
    await api().post("/api/v1/payments/top-up").set(bearer(buyer)).send({ amount: 500 }).expect(400);
    const bad = await api().post("/api/v1/payments/top-up").set(bearer(buyer)).send({ amount: 5000, returnUrl: "https://evil.example/steal" }).expect(400);
    expect(bad.body.code).toBe("INVALID_RETURN_URL");
    await api().post("/api/v1/payments/top-up").set(bearer(buyer)).send({ amount: 5000, returnUrl: "gbanjo://payment-result" }).expect(201);
    await api().post("/api/v1/payments/top-up").send({ amount: 5000 }).expect(401);
  });

  it("a declined or canceled card payment adds nothing", async () => {
    const res = await api().post("/api/v1/payments/top-up").set(bearer(buyer)).send({ amount: 2000, returnUrl: RETURN }).expect(201);
    const back = await pay(res.body.checkoutUrl, "cancelled");
    expect(back.searchParams.get("status")).toBe("canceled");
    const res2 = await api().post("/api/v1/payments/top-up").set(bearer(buyer)).send({ amount: 2000, returnUrl: RETURN }).expect(201);
    expect((await pay(res2.body.checkoutUrl, "failed")).searchParams.get("status")).toBe("failed");
    expect((await balance(buyer)).balance).toBe("0.00");
  });

  it("rejects webhooks without the secret hash", async () => {
    await api().post("/api/v1/payments/flutterwave/webhook").send({ data: { tx_ref: "x" } }).expect(401);
    await api().post("/api/v1/payments/flutterwave/webhook").set("verif-hash", "wrong").send({ data: { tx_ref: "x" } }).expect(401);
    await api().post("/api/v1/payments/flutterwave/webhook").set("verif-hash", "test-webhook-hash").send({ data: { tx_ref: "unknown" } }).expect(200);
  });

  it("checks vouchers", async () => {
    expect((await api().post("/api/v1/vouchers/check").set(bearer(buyer)).send({ code: "gbanjo10" }).expect(200)).body).toEqual({ code: "GBANJO10", percentOff: 10 });
    const bad = await api().post("/api/v1/vouchers/check").set(bearer(buyer)).send({ code: "NOPE" }).expect(404);
    expect(bad.body.code).toBe("INVALID_VOUCHER");
  });

  it("pays from the wallet: one order per seller, cart emptied, sellers see their part", async () => {
    await topUp(buyer, 50000);
    await api().post("/api/v1/cart/items").set(bearer(buyer)).send({ productId: "shoes", option: "Black, Size 42" }).expect(200);
    await api().post("/api/v1/cart/items").set(bearer(buyer)).send({ productId: "bag", qty: 2 }).expect(200);

    const short = await api().post("/api/v1/orders/checkout").set(bearer(seller)).send({ shipping: "standard", paymentMethod: "wallet", items: [{ productId: "bag", qty: 1 }], ...delivery }).expect(402);
    expect(short.body.code).toBe("INSUFFICIENT_FUNDS");

    const res = await api()
      .post("/api/v1/orders/checkout")
      .set(bearer(buyer))
      .send({ shipping: "express", paymentMethod: "wallet", voucher: "GBANJO10", ...delivery })
      .expect(201);
    // shoes 17,000 (−1,700) + bags 16,000 (−1,600) + express 12,000 once = 41,700
    expect(res.body.payment).toMatchObject({ status: "successful", method: "wallet", amount: 41700, checkoutUrl: null });
    expect(res.body.orders).toHaveLength(2);
    expect(res.body.orders.map((o: { total: number }) => o.total).sort()).toEqual([14400, 27300]);
    const shoes = res.body.orders.find((o: { items: { productId: string }[] }) => o.items[0].productId === "shoes");
    expect(shoes).toMatchObject({
      side: "buy",
      status: "ongoing",
      stage: 0,
      stageLabel: "Order confirmed",
      phone: "+2349045654356",
      paidWith: "wallet",
      canCancel: true,
      canAdvance: false,
      seller: { name: expect.any(String) },
      items: [{ productId: "shoes", name: "Shoes", option: "Black, Size 42", price: 17000, image: "/x.png", qty: 1 }],
    });
    expect(shoes.id).toMatch(/^\d{8}$/);
    expect(shoes.stageTimes[0]).toEqual(expect.any(String));

    expect((await balance(buyer)).balance).toBe("8300.00");
    expect((await api().get("/api/v1/cart").set(bearer(buyer)).expect(200)).body.items).toEqual([]);

    const mine = await api().get("/api/v1/orders?side=buy&status=ongoing").set(bearer(buyer)).expect(200);
    expect(mine.body).toHaveLength(2);
    const sold = await api().get("/api/v1/orders?side=sell").set(bearer(seller)).expect(200);
    expect(sold.body).toHaveLength(1);
    expect(sold.body[0]).toMatchObject({ id: shoes.id, side: "sell", canAdvance: true, nextStage: "Packed", buyer: { name: expect.any(String) } });
    // Other people can't see it.
    await api().get(`/api/v1/orders/${shoes.id}`).set(bearer(seller2)).expect(404);
  });

  it("seller moves it to delivered; earnings reach the seller's wallet", async () => {
    await topUp(buyer, 20000);
    const res = await api().post("/api/v1/orders/checkout").set(bearer(buyer)).send({ shipping: "standard", paymentMethod: "wallet", items: [{ productId: "shoes", qty: 1 }], ...delivery }).expect(201);
    const id = res.body.orders[0].id;

    await api().post(`/api/v1/orders/${id}/advance`).set(bearer(buyer)).expect(403);
    let o = res.body.orders[0];
    for (const expected of ["Packed", "Shipped", "Out for delivery", "Delivered"]) {
      o = (await api().post(`/api/v1/orders/${id}/advance`).set(bearer(seller)).expect(200)).body;
      expect(o.stageLabel).toBe(expected);
    }
    expect(o).toMatchObject({ status: "completed", stage: 4, canAdvance: false, canCancel: false });
    expect(o.stageTimes.every((t: string | null) => !!t)).toBe(true);
    await api().post(`/api/v1/orders/${id}/advance`).set(bearer(seller)).expect(403);
    await api().post(`/api/v1/orders/${id}/cancel`).set(bearer(buyer)).expect(409);

    // Earnings are held for ORDER_PAYOUT_HOLD_DAYS (3), then move into the balance.
    expect(await balance(seller)).toMatchObject({ balance: "0.00", pending: "17000.00" });
    await prisma.walletTransaction.updateMany({ where: { reference: `sale:${id}` }, data: { availableAt: new Date(Date.now() - 1000) } });
    expect(await balance(seller)).toMatchObject({ balance: "17000.00", pending: "0.00" });
    expect(await balance(seller)).toMatchObject({ balance: "17000.00" }); // settles once
    expect((await api().get("/api/v1/orders?side=sell&status=completed").set(bearer(seller)).expect(200)).body).toHaveLength(1);
  });

  it("canceling before it ships refunds the wallet; after shipping it can't be canceled", async () => {
    await topUp(buyer, 40000);
    const res = await api().post("/api/v1/orders/checkout").set(bearer(buyer)).send({ shipping: "standard", paymentMethod: "wallet", items: [{ productId: "shoes", qty: 1 }, { productId: "bag", qty: 1 }], ...delivery }).expect(201);
    const idOf = (slug: string) => res.body.orders.find((o: { items: { productId: string }[] }) => o.items[0].productId === slug).id as string;
    const [a, b] = [idOf("shoes"), idOf("bag")];
    expect((await balance(buyer)).balance).toBe("15000.00");

    const canceled = (await api().post(`/api/v1/orders/${a}/cancel`).set(bearer(buyer)).expect(200)).body;
    expect(canceled).toMatchObject({ status: "canceled", canceledBy: "buyer", refundTo: "wallet", stageLabel: "Canceled" });
    await api().post(`/api/v1/orders/${a}/cancel`).set(bearer(buyer)).expect(409);

    const seller2Order = (await api().get(`/api/v1/orders/${b}`).set(bearer(seller2)).expect(200)).body;
    await api().post(`/api/v1/orders/${seller2Order.id}/advance`).set(bearer(seller2)).expect(200);
    await api().post(`/api/v1/orders/${seller2Order.id}/advance`).set(bearer(seller2)).expect(200); // shipped
    await api().post(`/api/v1/orders/${b}/cancel`).set(bearer(buyer)).expect(409);

    const after = await balance(buyer);
    expect(after.balance).toBe(String(15000 + 17000) + ".00");
  });

  it("card checkout: hidden until paid, live after the payment page, cart cleared", async () => {
    await api().post("/api/v1/cart/items").set(bearer(buyer)).send({ productId: "house-shirt" }).expect(200);
    const res = await api().post("/api/v1/orders/checkout").set(bearer(buyer)).send({ shipping: "standard", paymentMethod: "card", returnUrl: RETURN, ...delivery }).expect(201);
    expect(res.body.payment).toMatchObject({ status: "pending", method: "card", amount: 5000, checkoutUrl: expect.stringContaining("/payments/test-checkout/") });
    const id = res.body.orders[0].id;
    expect(res.body.payment.orderIds).toEqual([id]);
    expect((await api().get("/api/v1/orders").set(bearer(buyer)).expect(200)).body).toEqual([]);
    await api().get(`/api/v1/orders/${id}`).set(bearer(buyer)).expect(404);

    const back = await pay(res.body.payment.checkoutUrl);
    expect(back.origin + back.pathname).toBe(RETURN);
    expect(back.searchParams.get("status")).toBe("successful");
    const p = (await api().get(`/api/v1/payments/${back.searchParams.get("reference")}`).set(bearer(buyer)).expect(200)).body;
    expect(p).toMatchObject({ status: "successful", orderIds: [id], purpose: "order" });

    const o = (await api().get(`/api/v1/orders/${id}`).set(bearer(buyer)).expect(200)).body;
    expect(o).toMatchObject({ status: "ongoing", stage: 0, paidWith: "card", seller: null });
    expect((await api().get("/api/v1/cart").set(bearer(buyer)).expect(200)).body.items).toEqual([]);

    // Gbanjo's own items: only an admin can move them along.
    await api().post(`/api/v1/orders/${id}/advance`).set(bearer(seller)).expect(404);
    await prisma.user.update({ where: { id: await userId("seller") }, data: { role: "ADMIN" } });
    const admin = await signIn("seller");
    expect((await api().get("/api/v1/admin/orders").set(bearer(admin)).expect(200)).body).toHaveLength(1);
    expect((await api().post(`/api/v1/orders/${id}/advance`).set(bearer(admin)).expect(200)).body.stageLabel).toBe("Packed");

    // Canceling a card order refunds the card.
    const c = (await api().post(`/api/v1/orders/${id}/cancel`).set(bearer(buyer)).expect(200)).body;
    expect(c).toMatchObject({ status: "canceled", refundTo: "card" });
  });

  it("a canceled card checkout leaves no order", async () => {
    const res = await api().post("/api/v1/orders/checkout").set(bearer(buyer)).send({ shipping: "standard", paymentMethod: "card", items: [{ productId: "shoes", qty: 1 }], returnUrl: RETURN, ...delivery }).expect(201);
    const back = await pay(res.body.payment.checkoutUrl, "cancelled");
    expect(back.searchParams.get("status")).toBe("canceled");
    expect((await api().get("/api/v1/orders").set(bearer(buyer)).expect(200)).body).toEqual([]);
    expect((await api().get("/api/v1/orders?side=sell").set(bearer(seller)).expect(200)).body).toEqual([]);
  });

  it("refuses bad checkouts", async () => {
    const empty = await api().post("/api/v1/orders/checkout").set(bearer(buyer)).send({ shipping: "standard", paymentMethod: "wallet", ...delivery }).expect(400);
    expect(empty.body.code).toBe("CART_EMPTY");
    const gone = await api().post("/api/v1/orders/checkout").set(bearer(buyer)).send({ shipping: "standard", paymentMethod: "wallet", items: [{ productId: "gone", qty: 1 }], ...delivery }).expect(409);
    expect(gone.body).toMatchObject({ code: "ITEMS_UNAVAILABLE", details: { items: ["gone"] } });
    const own = await api().post("/api/v1/orders/checkout").set(bearer(seller)).send({ shipping: "standard", paymentMethod: "wallet", items: [{ productId: "shoes", qty: 1 }], ...delivery }).expect(400);
    expect(own.body.code).toBe("OWN_LISTING");
    const noAddress = await api().post("/api/v1/orders/checkout").set(bearer(buyer)).send({ shipping: "standard", paymentMethod: "wallet", items: [{ productId: "shoes", qty: 1 }] }).expect(400);
    expect(noAddress.body.code).toBe("ADDRESS_REQUIRED");
    const badPhone = await api().post("/api/v1/orders/checkout").set(bearer(buyer)).send({ shipping: "standard", paymentMethod: "wallet", items: [{ productId: "shoes", qty: 1 }], ...delivery, phone: "123" }).expect(400);
    expect(badPhone.body.code).toBe("INVALID_PHONE");
    const voucher = await api().post("/api/v1/orders/checkout").set(bearer(buyer)).send({ shipping: "standard", paymentMethod: "wallet", voucher: "NOPE", items: [{ productId: "shoes", qty: 1 }], ...delivery }).expect(404);
    expect(voucher.body.code).toBe("INVALID_VOUCHER");
    await api().post("/api/v1/orders/checkout").send({ shipping: "standard", paymentMethod: "wallet" }).expect(401);
  });

  it("uses the default saved address when none is typed", async () => {
    await api().post("/api/v1/addresses").set(bearer(buyer)).send({ label: "Home", name: "Ada Obi", phone: "08031234567", address: "3 Allen Avenue, Ikeja" }).expect(201);
    await topUp(buyer, 20000);
    const res = await api().post("/api/v1/orders/checkout").set(bearer(buyer)).send({ shipping: "standard", paymentMethod: "wallet", items: [{ productId: "shoes", qty: 1 }] }).expect(201);
    expect(res.body.orders[0]).toMatchObject({ recipient: "Ada Obi", phone: "+2348031234567", address: "3 Allen Avenue, Ikeja" });
  });
});
