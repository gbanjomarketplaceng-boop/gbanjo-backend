import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./app.factory";

const DAY = 86_400_000;

describe("Catalog (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    const clothing = await prisma.category.create({ data: { slug: "clothing", name: "Clothing", blurb: "Style", imageUrl: "/c.png", sortOrder: 1 } });
    const homes = await prisma.category.create({ data: { slug: "properties", name: "Properties", blurb: "Spaces", imageUrl: "/p.png", sortOrder: 0 } });
    const old = new Date(Date.now() - 60 * DAY);
    const base = { location: "Lagos, Nigeria", imageUrl: "/x.png", tags: "", gallery: [], variations: [] };
    await prisma.product.createMany({
      data: [
        { ...base, slug: "sale-sneakers", name: "Sale sneakers", price: 17000, oldPrice: 21250, flashSaleEndsAt: new Date(Date.now() + DAY), categoryId: clothing.id, createdAt: old, rating: 4, reviewCount: 20 },
        { ...base, slug: "expired-sale", name: "Expired sale jacket", price: 9000, oldPrice: 12000, flashSaleEndsAt: new Date(Date.now() - DAY), categoryId: clothing.id, createdAt: old },
        { ...base, slug: "fresh-watch", name: "Fresh watch", price: 32000, categoryId: clothing.id, createdAt: new Date(), rating: 4, tags: "Clothing · Accessories" },
        { ...base, slug: "duplex", name: "Spacious duplex", price: 50000000, categoryId: homes.id, createdAt: old, featuredScore: 10, rating: 5, reviewCount: 4 },
        { ...base, slug: "bungalow", name: "Cosy bungalow", price: 30000000, categoryId: homes.id, createdAt: old, rating: 3 },
        { ...base, slug: "hidden-draft", name: "Draft item", price: 1000, categoryId: clothing.id, status: "DRAFT", createdAt: new Date() },
      ],
    });
  });

  afterAll(async () => {
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await app.close();
  });

  it("lists categories in order with active product counts", async () => {
    const res = await api().get("/api/v1/categories").expect(200);
    expect(res.body).toEqual([
      { slug: "properties", name: "Properties", blurb: "Spaces", image: "/p.png", productCount: 2 },
      { slug: "clothing", name: "Clothing", blurb: "Style", image: "/c.png", productCount: 3 },
    ]);
  });

  it("browses, filters, searches, sorts and paginates (never showing drafts)", async () => {
    const all = await api().get("/api/v1/products").expect(200);
    expect(all.body.total).toBe(5);
    expect(all.body.items.map((p: { id: string }) => p.id)).not.toContain("hidden-draft");

    const cat = await api().get("/api/v1/products?category=properties&sort=price_asc").expect(200);
    expect(cat.body.items.map((p: { id: string }) => p.id)).toEqual(["bungalow", "duplex"]);

    const search = await api().get("/api/v1/products?q=ACCESSORIES").expect(200);
    expect(search.body.items.map((p: { id: string }) => p.id)).toEqual(["fresh-watch"]);

    const price = await api().get("/api/v1/products?minPrice=10000&maxPrice=40000&sort=price_desc").expect(200);
    expect(price.body.items.map((p: { id: string }) => p.id)).toEqual(["fresh-watch", "sale-sneakers"]);

    const page = await api().get("/api/v1/products?limit=2&page=3").expect(200);
    expect(page.body).toMatchObject({ total: 5, page: 3, limit: 2 });
    expect(page.body.items).toHaveLength(1);

    const bad = await api().get("/api/v1/products?sort=cheapest").expect(400);
    expect(bad.body.code).toBe("VALIDATION_FAILED");
  });

  it("search: words in any order, across name/tags/category, ranked by relevance", async () => {
    const reversed = await api().get("/api/v1/products?q=SNEAKERS%20sale").expect(200);
    expect(reversed.body.items.map((p: { id: string }) => p.id)).toEqual(["sale-sneakers"]);

    const viaCategory = await api().get("/api/v1/products?q=clothing%20watch").expect(200);
    expect(viaCategory.body.items.map((p: { id: string }) => p.id)).toEqual(["fresh-watch"]);

    const none = await api().get("/api/v1/products?q=sneakers%20bungalow").expect(200);
    expect(none.body).toMatchObject({ total: 0, items: [] });

    // "spacious" is only in the duplex's name; "properties" (category) matches both homes.
    const ranked = await api().get("/api/v1/products?q=properties%20spacious").expect(200);
    expect(ranked.body.items.map((p: { id: string }) => p.id)).toEqual(["duplex"]);
    const homes = await api().get("/api/v1/products?q=properties").expect(200);
    expect(homes.body.total).toBe(2);

    // An explicit sort still applies to search results.
    const cheap = await api().get("/api/v1/products?q=properties&sort=price_asc").expect(200);
    expect(cheap.body.items.map((p: { id: string }) => p.id)).toEqual(["bungalow", "duplex"]);
  });

  it("suggestions: top products and matching categories", async () => {
    const res = await api().get("/api/v1/search/suggestions?q=clo").expect(200);
    expect(res.body.categories.map((c: { slug: string }) => c.slug)).toEqual(["clothing"]);
    expect(res.body.total).toBe(3);
    expect(res.body.products.length).toBeGreaterThan(0);
    const empty = await api().get("/api/v1/search/suggestions?q=%20%20").expect(200);
    expect(empty.body).toMatchObject({ products: [], categories: [], total: 0 });
  });

  it("returns a product with badges in the web app's shape", async () => {
    const sale = await api().get("/api/v1/products/sale-sneakers").expect(200);
    expect(sale.body).toMatchObject({ id: "sale-sneakers", price: 17000, oldPrice: 21250, badge: { label: "-20%", tone: "sale" }, category: "clothing", categoryName: "Clothing", rating: 4, reviews: 20 });

    const fresh = await api().get("/api/v1/products/fresh-watch").expect(200);
    expect(fresh.body.badge).toEqual({ label: "New", tone: "new" });

    const expired = await api().get("/api/v1/products/expired-sale").expect(200);
    expect(expired.body.flashSaleEndsAt).toBeUndefined();

    await api().get("/api/v1/products/hidden-draft").expect(404);
    const missing = await api().get("/api/v1/products/nope").expect(404);
    expect(missing.body.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("flash sale only includes discounted items that haven't ended", async () => {
    const res = await api().get("/api/v1/products/flash-sale").expect(200);
    expect(res.body.items.map((p: { id: string }) => p.id)).toEqual(["sale-sneakers"]);
    expect(new Date(res.body.endsAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("new items are the recent listings", async () => {
    const res = await api().get("/api/v1/products/new").expect(200);
    expect(res.body.map((p: { id: string }) => p.id)).toEqual(["fresh-watch"]);
  });

  it("just for you: featured first, preferred categories boosted, category filter", async () => {
    const plain = await api().get("/api/v1/products/just-for-you?limit=2").expect(200);
    expect(plain.body[0].id).toBe("duplex");

    const filtered = await api().get("/api/v1/products/just-for-you?category=clothing").expect(200);
    expect(filtered.body.every((p: { category: string }) => p.category === "clothing")).toBe(true);

    const preferred = await api().get("/api/v1/products/just-for-you?prefer=clothing&exclude=duplex&limit=3").expect(200);
    expect(preferred.body.map((p: { category: string }) => p.category)).toEqual(["clothing", "clothing", "clothing"]);
  });

  it("similar products: same category first", async () => {
    const res = await api().get("/api/v1/products/duplex/similar?limit=3").expect(200);
    expect(res.body[0].id).toBe("bungalow");
    expect(res.body.map((p: { id: string }) => p.id)).not.toContain("duplex");
  });

  it("home: all rails in one call without repeating items", async () => {
    const res = await api().get("/api/v1/catalog/home").expect(200);
    expect(res.body.categories).toHaveLength(2);
    expect(res.body.flashSale.items.map((p: { id: string }) => p.id)).toEqual(["sale-sneakers"]);
    expect(res.body.newItems.map((p: { id: string }) => p.id)).toEqual(["fresh-watch"]);
    const jfy = res.body.justForYou.map((p: { id: string }) => p.id);
    expect(jfy[0]).toBe("duplex");
    expect(jfy).not.toContain("sale-sneakers");
    expect(jfy).not.toContain("fresh-watch");
  });
});
