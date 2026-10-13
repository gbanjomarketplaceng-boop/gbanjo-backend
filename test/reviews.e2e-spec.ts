import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./app.factory";

describe("Reviews (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const signIn = async (sub: string) => {
    const res = await api().post("/api/v1/auth/oauth/google").send({ idToken: `ok:${sub}:${sub}@gmail.com` }).expect(200);
    return { token: res.body.accessToken as string, id: res.body.user.id as string };
  };

  beforeAll(async () => {
    ({ app, prisma, reset } = await createTestApp());
  });
  afterAll(async () => {
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await app.close();
  });

  let seller: { token: string; id: string };
  beforeEach(async () => {
    await reset();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    seller = await signIn("seller");
    const cat = await prisma.category.create({ data: { slug: "clothing", name: "Clothing", imageUrl: "/c.png" } });
    // Seeded numbers get replaced by real ones as soon as someone reviews.
    await prisma.product.create({ data: { slug: "jacket", name: "Jacket", price: 9000, categoryId: cat.id, location: "Lagos", imageUrl: "/j.png", rating: 4, reviewCount: 20, sellerId: seller.id } });
  });

  it("reviews, updates the product's rating, edits and deletes", async () => {
    const empty = await api().get("/api/v1/products/jacket/reviews").expect(200);
    expect(empty.body).toMatchObject({ items: [], total: 0, summary: { average: 0, count: 0 } });

    const a = await signIn("ann");
    const b = await signIn("ben");
    expect((await api().get("/api/v1/products/jacket/reviews/mine").set(bearer(a.token)).expect(200)).body).toEqual({ review: null, canReview: true });

    const r1 = await api().put("/api/v1/products/jacket/reviews/mine").set(bearer(a.token)).send({ rating: 5, text: "  Love it!  " }).expect(200);
    expect(r1.body).toMatchObject({ rating: 5, text: "Love it!", author: { name: "Romina W." }, edited: false });
    await api().put("/api/v1/products/jacket/reviews/mine").set(bearer(b.token)).send({ rating: 2 }).expect(200);

    let page = await api().get("/api/v1/products/jacket/reviews").expect(200);
    expect(page.body.summary).toEqual({ average: 3.5, count: 2, breakdown: { "1": 0, "2": 1, "3": 0, "4": 0, "5": 1 } });
    const product = await api().get("/api/v1/products/jacket").expect(200);
    expect(product.body).toMatchObject({ rating: 3.5, reviews: 2 });

    // One review per person: sending again edits it.
    await new Promise((r) => setTimeout(r, 1100));
    const edited = await api().put("/api/v1/products/jacket/reviews/mine").set(bearer(b.token)).send({ rating: 4, text: "Better than I thought" }).expect(200);
    expect(edited.body).toMatchObject({ rating: 4, edited: true });
    page = await api().get("/api/v1/products/jacket/reviews?sort=lowest").expect(200);
    expect(page.body.items.map((r: { rating: number }) => r.rating)).toEqual([4, 5]);
    expect(page.body.summary).toMatchObject({ average: 4.5, count: 2 });

    await api().delete("/api/v1/products/jacket/reviews/mine").set(bearer(a.token)).expect(204);
    await api().delete("/api/v1/products/jacket/reviews/mine").set(bearer(a.token)).expect(404);
    expect((await api().get("/api/v1/products/jacket")).body).toMatchObject({ rating: 4, reviews: 1 });
  });

  it("validates, blocks the seller and needs sign-in to write", async () => {
    const a = await signIn("ann");
    for (const rating of [0, 6, 3.5, "x"]) await api().put("/api/v1/products/jacket/reviews/mine").set(bearer(a.token)).send({ rating }).expect(400);
    await api().put("/api/v1/products/jacket/reviews/mine").set(bearer(a.token)).send({ rating: 3, text: "x".repeat(1001) }).expect(400);
    await api().put("/api/v1/products/jacket/reviews/mine").send({ rating: 3 }).expect(401);
    const own = await api().put("/api/v1/products/jacket/reviews/mine").set(bearer(seller.token)).send({ rating: 5 }).expect(403);
    expect(own.body.code).toBe("OWN_LISTING");
    expect((await api().get("/api/v1/products/jacket/reviews/mine").set(bearer(seller.token))).body.canReview).toBe(false);
    await api().get("/api/v1/products/nope/reviews").expect(404);
  });

  it("admins can remove a review", async () => {
    const a = await signIn("ann");
    const { body } = await api().put("/api/v1/products/jacket/reviews/mine").set(bearer(a.token)).send({ rating: 1, text: "spam" }).expect(200);
    await api().delete(`/api/v1/admin/reviews/${body.id}`).set(bearer(a.token)).expect(403);
    const admin = await signIn("admin");
    await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    await api().delete(`/api/v1/admin/reviews/${body.id}`).set(bearer(admin.token)).expect(204);
    expect((await api().get("/api/v1/products/jacket")).body).toMatchObject({ rating: 0, reviews: 0 });
  });
});
