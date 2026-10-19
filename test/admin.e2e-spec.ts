import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./app.factory";

/** The admin panel's back office: roles, settings, money tools, catalog tools, team and the activity log. */
describe("Admin panel (e2e)", () => {
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
  const admin = async (sub: string, adminRole: "SUPER" | "FINANCE" | "SUPPORT" | "CATALOG") => {
    const u = await signIn(sub);
    await prisma.user.update({ where: { id: u.id }, data: { role: "ADMIN", adminRole } });
    return signIn(sub);
  };
  const fund = async (userId: string, amount: number) => {
    const w = await prisma.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
    await prisma.wallet.update({ where: { id: w.id }, data: { balance: amount } });
  };
  const balance = async (userId: string) => Number((await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance);
  const buy = (token: string, extra: Record<string, unknown> = {}) =>
    api().post("/api/v1/orders/checkout").set(bearer(token)).send({ shipping: "standard", paymentMethod: "wallet", items: [{ productId: "shoes", qty: 1 }], ...delivery, ...extra });

  let seller: { token: string; id: string };
  let buyer: { token: string; id: string };
  let superAdmin: { token: string; id: string };

  beforeAll(async () => {
    ({ app, prisma, reset } = await createTestApp());
  });

  beforeEach(async () => {
    await reset();
    await prisma.voucher.deleteMany({ where: { code: { in: ["ONCE", "BIG", "TEN"] } } });
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    seller = await signIn("seller");
    buyer = await signIn("buyer");
    superAdmin = await admin("boss", "SUPER");
    const cat = await prisma.category.create({ data: { slug: "clothing", name: "Clothing", imageUrl: "/c.png" } });
    await prisma.product.create({ data: { slug: "shoes", name: "Shoes", price: 10000, location: "Lagos", imageUrl: "/x.png", gallery: [], variations: [], categoryId: cat.id, sellerId: seller.id } });
  });

  afterAll(async () => {
    await prisma.voucher.deleteMany({ where: { code: { in: ["ONCE", "BIG", "TEN"] } } });
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await app.close();
  });

  it("each admin role only reaches its own part of the panel", async () => {
    const support = await admin("support", "SUPPORT");
    const finance = await admin("finance", "FINANCE");
    const catalog = await admin("catalog", "CATALOG");

    expect((await api().get("/api/v1/admin/me").set(bearer(support.token)).expect(200)).body).toMatchObject({ adminRole: "SUPPORT", areas: ["dashboard", "orders", "users", "moderation"] });
    await api().get("/api/v1/admin/finance/summary").set(bearer(support.token)).expect(403);
    await api().get("/api/v1/admin/finance/summary").set(bearer(finance.token)).expect(200);
    await api().post("/api/v1/admin/vouchers").set(bearer(finance.token)).send({ code: "TEN", percentOff: 10 }).expect(403);
    await api().post("/api/v1/admin/vouchers").set(bearer(catalog.token)).send({ code: "TEN", percentOff: 10 }).expect(201);
    await api().get("/api/v1/admin/reports").set(bearer(catalog.token)).expect(200);
    await api().get("/api/v1/admin/withdrawals").set(bearer(catalog.token)).expect(403);
    await api().patch("/api/v1/admin/settings").set(bearer(finance.token)).send({ platformFeePercent: 5 }).expect(403);
    await api().get("/api/v1/admin/team").set(bearer(support.token)).expect(403);
    await api().get("/api/v1/admin/dashboard").set(bearer(buyer.token)).expect(403);
  });

  it("settings change the delivery fee and commission; the dashboard and finance report add it up", async () => {
    await api().patch("/api/v1/admin/settings").set(bearer(superAdmin.token)).send({ platformFeePercent: 10, expressShippingFee: 5000 }).expect(200);
    expect((await api().get("/api/v1/settings/public").expect(200)).body).toEqual({ expressShippingFee: 5000, withdrawalMin: 1000 });
    await api().patch("/api/v1/admin/settings").set(bearer(superAdmin.token)).send({ platformFeePercent: 80 }).expect(400);

    await fund(buyer.id, 50000);
    const order = (await buy(buyer.token, { shipping: "express" }).expect(201)).body.orders[0];
    expect(order.total).toBe(15000);
    for (let i = 0; i < 4; i++) await api().post(`/api/v1/orders/${order.id}/advance`).set(bearer(seller.token)).expect(200);
    expect(Number((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).platformFee)).toBe(1000);
    const sale = await prisma.walletTransaction.findFirstOrThrow({ where: { type: "SALE" } });
    expect(Number(sale.amount)).toBe(9000);

    const dash = (await api().get("/api/v1/admin/dashboard?days=7").set(bearer(superAdmin.token)).expect(200)).body;
    expect(dash.kpis).toMatchObject({ gmv: 15000, orders: 1, averageOrder: 15000, revenue: 1000, heldEarnings: 9000 });
    expect(dash.daily).toHaveLength(7);
    expect(dash.daily[6]).toMatchObject({ orders: 1, gmv: 15000 });
    expect(dash.topSellers[0]).toMatchObject({ id: seller.id, gmv: 10000, orders: 1 });
    expect(dash.topCategories[0]).toMatchObject({ name: "Clothing", units: 1 });

    const fin = (await api().get("/api/v1/admin/finance/summary").set(bearer(superAdmin.token)).expect(200)).body;
    expect(fin.sales).toMatchObject({ orders: 1, gmv: 15000, items: 10000, deliveryFees: 5000 });
    expect(fin.revenue).toMatchObject({ commission: 1000, total: 1000 });
    expect(fin.paymentsByMethod).toEqual([{ method: "wallet", count: 1, amount: 15000 }]);

    const audit = (await api().get("/api/v1/admin/audit").set(bearer(superAdmin.token)).expect(200)).body;
    expect(audit.items[0]).toMatchObject({ summary: "Changed settings: platformFeePercent, expressShippingFee", admin: { id: superAdmin.id } });
  });

  it("vouchers: limited uses and a minimum order are enforced, even at the same moment", async () => {
    const catalog = await admin("catalog", "CATALOG");
    await api().post("/api/v1/admin/vouchers").set(bearer(catalog.token)).send({ code: "once", percentOff: 50, maxUses: 1, minOrder: 5000 }).expect(201);
    await api().post("/api/v1/vouchers/check").set(bearer(buyer.token)).send({ code: "ONCE" }).expect(200);
    const other = await signIn("other");
    await fund(buyer.id, 50000);
    await fund(other.id, 50000);
    const [a, b] = await Promise.all([buy(buyer.token, { voucher: "ONCE" }), buy(other.token, { voucher: "once" })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await prisma.voucher.findUniqueOrThrow({ where: { code: "ONCE" } })).usedCount).toBe(1);

    await api().post("/api/v1/admin/vouchers").set(bearer(catalog.token)).send({ code: "BIG", percentOff: 10, minOrder: 20000 }).expect(201);
    const small = await buy(buyer.token, { voucher: "BIG" }).expect(400);
    expect(small.body.code).toBe("VOUCHER_MIN_ORDER");

    const list = (await api().get("/api/v1/admin/vouchers").set(bearer(catalog.token)).expect(200)).body;
    expect(list.find((v: { code: string }) => v.code === "ONCE")).toMatchObject({ usedCount: 1, maxUses: 1, paidOrders: 1, discountGiven: 5000 });
    // A used voucher is switched off rather than deleted (orders refer to it).
    await api().delete("/api/v1/admin/vouchers/ONCE").set(bearer(catalog.token)).expect(204);
    expect((await prisma.voucher.findUniqueOrThrow({ where: { code: "ONCE" } })).active).toBe(false);
    await api().delete("/api/v1/admin/vouchers/BIG").set(bearer(catalog.token)).expect(204);
    expect(await prisma.voucher.findUnique({ where: { code: "BIG" } })).toBeNull();
  });

  it("wallet adjustments: add/take money with a reason, once per request key, never below zero", async () => {
    const finance = await admin("finance", "FINANCE");
    const key = { "Idempotency-Key": "adjust-000000001" };
    const add = () => api().post(`/api/v1/admin/users/${buyer.id}/wallet-adjustments`).set(bearer(finance.token)).set(key).send({ amount: 2500, reason: "Goodwill for late delivery" });
    await add().expect(201);
    await add().expect(201);
    expect(await balance(buyer.id)).toBe(2500);
    const take = await api().post(`/api/v1/admin/users/${buyer.id}/wallet-adjustments`).set(bearer(finance.token)).send({ amount: -9000, reason: "Reverse duplicate credit" }).expect(400);
    expect(take.body.code).toBe("INSUFFICIENT_FUNDS");
    await api().post(`/api/v1/admin/users/${finance.id}/wallet-adjustments`).set(bearer(finance.token)).send({ amount: 100, reason: "Paying myself" }).expect(400);
    await api().post(`/api/v1/admin/users/${buyer.id}/wallet-adjustments`).set(bearer(finance.token)).send({ amount: 100, reason: "no" }).expect(400);

    const detail = (await api().get(`/api/v1/admin/users/${buyer.id}`).set(bearer(finance.token)).expect(200)).body;
    expect(detail.wallet.balance).toBe(2500);
    expect(detail.ledger[0]).toMatchObject({ type: "adjustment", amount: 2500, description: "Adjustment by Gbanjo: Goodwill for late delivery" });
    const n = (await api().get("/api/v1/notifications").set(bearer(buyer.token)).expect(200)).body.items[0];
    expect(n.title).toBe("₦2,500 added to your wallet");
  });

  it("big withdrawals wait for approval; approve sends it, reject refunds it", async () => {
    await api().patch("/api/v1/admin/settings").set(bearer(superAdmin.token)).send({ withdrawalApprovalAbove: 3000 }).expect(200);
    await fund(seller.id, 20000);
    await api().put("/api/v1/wallet/bank-account").set(bearer(seller.token)).send({ bankCode: "044", accountNumber: "0123456789" }).expect(200);
    const small = (await api().post("/api/v1/wallet/withdrawals").set(bearer(seller.token)).send({ amount: 2000 }).expect(201)).body;
    expect(small.status).toBe("successful");
    const big = (await api().post("/api/v1/wallet/withdrawals").set(bearer(seller.token)).send({ amount: 5000 }).expect(201)).body;
    expect(big.status).toBe("awaiting_approval");
    expect(await balance(seller.id)).toBe(13000);

    const finance = await admin("finance", "FINANCE");
    const waiting = (await api().get("/api/v1/admin/withdrawals?status=awaiting_approval").set(bearer(finance.token)).expect(200)).body;
    expect(waiting).toHaveLength(1);
    const ok = await Promise.all([1, 2].map(() => api().post(`/api/v1/admin/withdrawals/${big.id}/approve`).set(bearer(finance.token))));
    expect(ok.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await prisma.withdrawal.findUniqueOrThrow({ where: { id: big.id } })).status).toBe("SUCCESSFUL");

    const third = (await api().post("/api/v1/wallet/withdrawals").set(bearer(seller.token)).send({ amount: 4000 }).expect(201)).body;
    await api().post(`/api/v1/admin/withdrawals/${third.id}/reject`).set(bearer(finance.token)).send({ reason: "Account name doesn't match" }).expect(201);
    expect(await balance(seller.id)).toBe(13000);
    expect((await prisma.withdrawal.findUniqueOrThrow({ where: { id: third.id } })).failureReason).toBe("Account name doesn't match");
  });

  it("team: add an admin by email, change or remove their role; nobody changes their own", async () => {
    const someone = await signIn("helper");
    const team = (await api().put("/api/v1/admin/team").set(bearer(superAdmin.token)).send({ email: "helper@gmail.com", adminRole: "SUPPORT" }).expect(200)).body;
    expect(team.find((t: { email: string }) => t.email === "helper@gmail.com")).toMatchObject({ adminRole: "SUPPORT" });
    await api().get("/api/v1/admin/reports").set(bearer(someone.token)).expect(200);
    await api().put("/api/v1/admin/team").set(bearer(superAdmin.token)).send({ email: "nobody@gmail.com", adminRole: "SUPPORT" }).expect(404);
    await api().patch(`/api/v1/admin/team/${superAdmin.id}`).set(bearer(superAdmin.token)).send({ adminRole: null }).expect(400);
    await api().patch(`/api/v1/admin/team/${buyer.id}`).set(bearer(superAdmin.token)).send({ adminRole: "SUPPORT" }).expect(404);

    // Removing access works at once (no need to sign out).
    await api().patch(`/api/v1/admin/team/${someone.id}`).set(bearer(superAdmin.token)).send({ adminRole: null }).expect(200);
    await api().get("/api/v1/admin/reports").set(bearer(someone.token)).expect(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: someone.id } })).role).toBe("USER");

    const audit = (await api().get("/api/v1/admin/audit").set(bearer(superAdmin.token)).expect(200)).body.items.map((i: { summary: string }) => i.summary);
    expect(audit).toEqual(expect.arrayContaining(["Gave helper@gmail.com the support admin role", "Removed an admin"]));
  });

  it("catalog: categories, featuring a listing and a flash sale", async () => {
    const catalog = await admin("catalog", "CATALOG");
    const cats = (await api().post("/api/v1/admin/categories").set(bearer(catalog.token)).send({ name: "Kids & Baby", imageUrl: "https://res.cloudinary.com/demo/image/upload/k.jpg" }).expect(201)).body;
    const kids = cats.find((c: { slug: string }) => c.slug === "kids-and-baby");
    expect(kids).toMatchObject({ name: "Kids & Baby", products: 0 });
    await api().post("/api/v1/admin/categories").set(bearer(catalog.token)).send({ name: "Kids & Baby", imageUrl: "https://res.cloudinary.com/demo/image/upload/k.jpg" }).expect(409);
    const clothing = cats.find((c: { slug: string }) => c.slug === "clothing");
    await api().delete(`/api/v1/admin/categories/${clothing.id}`).set(bearer(catalog.token)).expect(409);
    await api().delete(`/api/v1/admin/categories/${kids.id}`).set(bearer(catalog.token)).expect(204);

    const shoes = await prisma.product.findUniqueOrThrow({ where: { slug: "shoes" } });
    await api().patch(`/api/v1/admin/listings/${shoes.id}`).set(bearer(catalog.token)).send({ flashSaleEndsAt: new Date(Date.now() + 86_400_000).toISOString(), oldPrice: 9000 }).expect(400);
    const l = (
      await api()
        .patch(`/api/v1/admin/listings/${shoes.id}`)
        .set(bearer(catalog.token))
        .send({ featured: true, flashSaleEndsAt: new Date(Date.now() + 86_400_000).toISOString(), oldPrice: 15000 })
        .expect(200)
    ).body;
    expect(l).toMatchObject({ featured: true, oldPrice: 15000, status: "active" });
    const page = (await api().get("/api/v1/admin/listings?status=featured").set(bearer(catalog.token)).expect(200)).body;
    expect(page).toMatchObject({ total: 1, page: 1, items: [{ slug: "shoes", seller: { id: seller.id } }] });
  });

  it("exports are spreadsheet-safe CSV files; broadcasts reach the chosen audience", async () => {
    await prisma.user.update({ where: { id: buyer.id }, data: { firstName: "=HYPERLINK(evil)" } });
    const res = await api().get("/api/v1/admin/exports/users").set(bearer(superAdmin.token)).expect(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="gbanjo-people_/);
    expect(res.text).toContain(`"'=HYPERLINK(evil)`);
    await api().get("/api/v1/admin/exports/secrets").set(bearer(superAdmin.token)).expect(404);

    await fund(buyer.id, 50000);
    await buy(buyer.token).expect(201);
    expect((await api().get("/api/v1/admin/broadcasts/audience").set(bearer(superAdmin.token)).expect(200)).body).toMatchObject({ buyers: 1 });
    const sent = (await api().post("/api/v1/admin/broadcasts").set(bearer(superAdmin.token)).send({ title: "Weekend sale", body: "Up to 50% off", href: "/products", audience: "buyers", kind: "promo" }).expect(201)).body;
    expect(sent).toMatchObject({ audience: "buyers", sent: 1 });
    const n = (await api().get("/api/v1/notifications").set(bearer(buyer.token)).expect(200)).body.items[0];
    expect(n).toMatchObject({ type: "promo", title: "Weekend sale", href: "/products" });
    await api().post("/api/v1/admin/broadcasts").set(bearer(superAdmin.token)).send({ title: "Hi", body: "x", audience: "everyone", kind: "announcement", href: "javascript:alert(1)" }).expect(400);
  });

  it("listings CRUD: create (own or for a seller), read, edit any field, delete; open orders block deleting", async () => {
    const catalog = await admin("catalog", "CATALOG");
    const support = await admin("support", "SUPPORT");
    const body = { name: "Blue denim jacket", price: 12000, category: "clothing", location: "Ikeja, Lagos", photos: ["https://example.com/a.jpg", "/images/b.png"] };

    await api().post("/api/v1/admin/listings").set(bearer(support.token)).send(body).expect(403);
    await api().post("/api/v1/admin/listings").set(bearer(catalog.token)).send({ name: "No photos", price: 5, category: "clothing", location: "Lagos" }).expect(400);
    await api().post("/api/v1/admin/listings").set(bearer(catalog.token)).send({ ...body, photos: ["javascript:alert(1)"] }).expect(400);
    await api().post("/api/v1/admin/listings").set(bearer(catalog.token)).send({ ...body, sellerEmail: "nobody@nowhere.com" }).expect(400);

    const own = (await api().post("/api/v1/admin/listings").set(bearer(catalog.token)).set("Idempotency-Key", "listing-create-1").send(body).expect(201)).body;
    expect(own).toMatchObject({ name: "Blue denim jacket", price: 12000, status: "active", seller: null, photos: body.photos, category: { slug: "clothing" } });
    // Same request key: no second listing.
    await api().post("/api/v1/admin/listings").set(bearer(catalog.token)).set("Idempotency-Key", "listing-create-1").send(body).expect(201);
    expect(await prisma.product.count({ where: { name: "Blue denim jacket" } })).toBe(1);

    const forSeller = (await api().post("/api/v1/admin/listings").set(bearer(catalog.token)).send({ ...body, name: "Seller jacket", sellerEmail: "seller@gmail.com" }).expect(201)).body;
    expect(forSeller.seller).toMatchObject({ id: seller.id });

    await api().patch(`/api/v1/admin/listings/${own.id}`).set(bearer(catalog.token)).send({ name: "Black denim jacket", price: 11000, status: "draft", description: "Warm" }).expect(200);
    const read = (await api().get(`/api/v1/admin/listings/${own.id}`).set(bearer(catalog.token)).expect(200)).body;
    expect(read).toMatchObject({ name: "Black denim jacket", price: 11000, status: "draft", description: "Warm" });

    await api().delete(`/api/v1/admin/listings/${own.id}`).set(bearer(catalog.token)).expect(204);
    await api().get(`/api/v1/admin/listings/${own.id}`).set(bearer(catalog.token)).expect(404);

    // A listing in an order that's still in progress can't be deleted.
    await fund(buyer.id, 50000);
    await buy(buyer.token).expect(201);
    const shoes = await prisma.product.findUniqueOrThrow({ where: { slug: "shoes" } });
    expect((await api().delete(`/api/v1/admin/listings/${shoes.id}`).set(bearer(catalog.token)).expect(409)).body.code).toBe("LISTING_IN_OPEN_ORDER");
  });

  it("people CRUD: create, edit (incl. new password), delete; admin accounts need a super admin", async () => {
    const support = await admin("support", "SUPPORT");
    const person = { firstName: "Tolu", lastName: "Bello", email: "Tolu@Example.com", phone: "08031110000", password: "Passw0rd1" };

    await api().post("/api/v1/admin/users").set(bearer(support.token)).send({ ...person, password: "short" }).expect(400);
    await api().post("/api/v1/admin/users").set(bearer(support.token)).send({ ...person, adminRole: "SUPER" }).expect(403);
    const tolu = (await api().post("/api/v1/admin/users").set(bearer(support.token)).send(person).expect(201)).body;
    expect(tolu).toMatchObject({ email: "tolu@example.com", phone: "+2348031110000", role: "user", status: "active" });
    await api().post("/api/v1/admin/users").set(bearer(support.token)).send(person).expect(409);
    // They can sign in straight away.
    await api().post("/api/v1/auth/login").send({ email: "tolu@example.com", password: "Passw0rd1" }).expect(200);

    await api().patch(`/api/v1/admin/users/${tolu.id}/details`).set(bearer(support.token)).send({ lastName: "Adeyemi", password: "NewPassw0rd" }).expect(200);
    await api().post("/api/v1/auth/login").send({ email: "tolu@example.com", password: "Passw0rd1" }).expect(401);
    await api().post("/api/v1/auth/login").send({ email: "tolu@example.com", password: "NewPassw0rd" }).expect(200);
    await api().patch(`/api/v1/admin/users/${tolu.id}/details`).set(bearer(support.token)).send({ email: "seller@gmail.com" }).expect(409);

    // Support can't touch admin accounts; a super admin can create one.
    await api().patch(`/api/v1/admin/users/${superAdmin.id}/details`).set(bearer(support.token)).send({ firstName: "X" }).expect(403);
    const fin = (await api().post("/api/v1/admin/users").set(bearer(superAdmin.token)).send({ ...person, email: "fin@example.com", phone: null, adminRole: "FINANCE" }).expect(201)).body;
    expect(fin).toMatchObject({ role: "admin", adminRole: "FINANCE" });
    await api().delete(`/api/v1/admin/users/${fin.id}`).set(bearer(support.token)).expect(403);

    // Money left in the wallet blocks deleting; once it's zero the account is wiped.
    await fund(tolu.id, 500);
    expect((await api().delete(`/api/v1/admin/users/${tolu.id}`).set(bearer(support.token)).expect(409)).body.code).toBe("WALLET_NOT_EMPTY");
    await fund(tolu.id, 0);
    await api().delete(`/api/v1/admin/users/${tolu.id}`).set(bearer(support.token)).expect(204);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: tolu.id } })).toMatchObject({ status: "DELETED", phone: null, firstName: "Deleted" });
    await api().delete(`/api/v1/admin/users/${support.id}`).set(bearer(support.token)).expect(400);

    const log = (await api().get("/api/v1/admin/audit").set(bearer(superAdmin.token)).expect(200)).body.items.map((e: { summary: string }) => e.summary);
    expect(log).toEqual(expect.arrayContaining(["Created an account for tolu@example.com", "Deleted an account"]));
    expect(JSON.stringify(log)).not.toContain("NewPassw0rd");
  });
});
