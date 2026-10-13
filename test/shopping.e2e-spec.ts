import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./app.factory";

describe("Wishlist & cart (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const ids = (list: { id: string }[]) => list.map((p) => p.id);

  const seed = async () => {
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    const cat = await prisma.category.create({ data: { slug: "clothing", name: "Clothing", imageUrl: "/c.png" } });
    const base = { location: "Lagos", imageUrl: "/x.png", gallery: [], categoryId: cat.id };
    await prisma.product.createMany({
      data: [
        { ...base, slug: "shoes", name: "Shoes", price: 17000, variations: ["Black", "42"] },
        { ...base, slug: "shirt", name: "Shirt", price: 5000, variations: [] },
        { ...base, slug: "draft", name: "Draft", price: 100, variations: [], status: "DRAFT" },
      ],
    });
  };

  beforeAll(async () => {
    ({ app, prisma, reset } = await createTestApp());
  });
  beforeEach(async () => {
    await reset();
    await seed();
  });
  afterAll(async () => {
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await app.close();
  });

  const signIn = async (sub = "u1") =>
    (await api().post("/api/v1/auth/oauth/google").send({ idToken: `ok:${sub}:${sub}@gmail.com` }).expect(200)).body.accessToken as string;

  it("needs a signed-in user", async () => {
    await api().get("/api/v1/wishlist").expect(401);
    await api().get("/api/v1/cart").expect(401);
  });

  it("new accounts start with an empty wishlist and cart", async () => {
    const t = await signIn();
    expect((await api().get("/api/v1/wishlist").set(bearer(t)).expect(200)).body).toEqual([]);
    expect((await api().get("/api/v1/cart").set(bearer(t)).expect(200)).body).toEqual({ items: [], count: 0, subtotal: 0 });
  });

  it("saves, lists, removes and merges wishlist items (only items for sale)", async () => {
    const t = await signIn();
    const added = await api().put("/api/v1/wishlist/shoes").set(bearer(t)).expect(200);
    expect(ids(added.body)).toEqual(["shoes"]);
    await api().put("/api/v1/wishlist/shoes").set(bearer(t)).expect(200); // idempotent
    const missing = await api().put("/api/v1/wishlist/draft").set(bearer(t)).expect(404);
    expect(missing.body.code).toBe("PRODUCT_NOT_FOUND");

    const merged = await api().post("/api/v1/wishlist/merge").set(bearer(t)).send({ productIds: ["shirt", "shoes", "nope", "draft"] }).expect(201);
    expect(ids(merged.body).sort()).toEqual(["shirt", "shoes"]);

    await api().delete("/api/v1/wishlist/shoes").set(bearer(t)).expect(204);
    expect(ids((await api().get("/api/v1/wishlist").set(bearer(t))).body)).toEqual(["shirt"]);

    // Someone else's wishlist is separate.
    const other = await signIn("u2");
    expect((await api().get("/api/v1/wishlist").set(bearer(other))).body).toEqual([]);

    // Items that stop being for sale drop out.
    await prisma.product.update({ where: { slug: "shirt" }, data: { status: "SOLD" } });
    expect((await api().get("/api/v1/wishlist").set(bearer(t))).body).toEqual([]);
  });

  it("adds to, updates and empties the cart with totals", async () => {
    const t = await signIn();
    let res = await api().post("/api/v1/cart/items").set(bearer(t)).send({ productId: "shoes" }).expect(200);
    expect(res.body.items[0]).toMatchObject({ product: { id: "shoes" }, qty: 1, option: "Black, Size 42" });
    res = await api().post("/api/v1/cart/items").set(bearer(t)).send({ productId: "shoes", qty: 2 }).expect(200);
    expect(res.body.items[0].qty).toBe(3);
    res = await api().post("/api/v1/cart/items").set(bearer(t)).send({ productId: "shirt", option: "Blue" }).expect(200);
    expect(res.body).toMatchObject({ count: 4, subtotal: 3 * 17000 + 5000 });

    res = await api().patch("/api/v1/cart/items/shoes").set(bearer(t)).send({ qty: 1 }).expect(200);
    expect(res.body.subtotal).toBe(22000);
    await api().patch("/api/v1/cart/items/shoes").set(bearer(t)).send({ qty: 0 }).expect(400);
    await api().patch("/api/v1/cart/items/draft").set(bearer(t)).send({ qty: 1 }).expect(404);
    await api().post("/api/v1/cart/items").set(bearer(t)).send({ productId: "draft" }).expect(404);

    await api().delete("/api/v1/cart/items/shirt").set(bearer(t)).expect(204);
    expect((await api().get("/api/v1/cart").set(bearer(t))).body.count).toBe(1);
    await api().delete("/api/v1/cart").set(bearer(t)).expect(204);
    expect((await api().get("/api/v1/cart").set(bearer(t))).body.items).toEqual([]);
  });

  it("merges the signed-out cart without doubling quantities", async () => {
    const t = await signIn();
    await api().post("/api/v1/cart/items").set(bearer(t)).send({ productId: "shoes", qty: 2 }).expect(200);
    const res = await api()
      .post("/api/v1/cart/merge")
      .set(bearer(t))
      .send({ items: [{ productId: "shoes", qty: 1 }, { productId: "shirt", qty: 3, option: "Red" }, { productId: "nope" }] })
      .expect(200);
    expect(res.body.items.map((i: { product: { id: string }; qty: number; option: string }) => [i.product.id, i.qty, i.option])).toEqual([
      ["shoes", 2, "Black, Size 42"],
      ["shirt", 3, "Red"],
    ]);
  });

  it("drops sold items from the cart", async () => {
    const t = await signIn();
    await api().post("/api/v1/cart/items").set(bearer(t)).send({ productId: "shirt" }).expect(200);
    await prisma.product.update({ where: { slug: "shirt" }, data: { status: "SOLD" } });
    expect((await api().get("/api/v1/cart").set(bearer(t))).body).toEqual({ items: [], count: 0, subtotal: 0 });
  });
});
