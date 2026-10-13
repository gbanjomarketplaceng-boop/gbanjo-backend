import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UploadsService } from "../src/modules/uploads/uploads.service";
import type { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./app.factory";

/** Cloudinary "configured" (nothing is called on it except URL checks). */
const cloudinaryConfig = {
  get: (k: string) => ({ CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "123", CLOUDINARY_API_SECRET: "s3cret", CLOUDINARY_FOLDER: "gbanjo" })[k],
};

describe("Selling (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ({ app, prisma, reset } = await createTestApp((b) =>
      b.overrideProvider(UploadsService).useValue(new UploadsService(cloudinaryConfig as never)),
    ));
  });
  beforeEach(async () => {
    await reset();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.category.create({ data: { slug: "electronics", name: "Electronics", imageUrl: "/e.png" } });
  });
  afterAll(async () => {
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await app.close();
  });

  const signIn = async (sub = "seller") => {
    const res = await api().post("/api/v1/auth/oauth/google").send({ idToken: `ok:${sub}:${sub}@gmail.com` }).expect(200);
    return { token: res.body.accessToken as string, id: res.body.user.id as string };
  };
  const photo = (userId: string, n = 1) => `https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/v17/gbanjo/listings/${userId}/p${n}`;
  const verify = (t: string, userId: string) =>
    api().post("/api/v1/seller/verification").set(bearer(t)).send({ idType: "nin", documentPublicId: `gbanjo/id-documents/${userId}/front` });

  it("verification: none → pending, only with the user's own ID upload; admins approve", async () => {
    const { token, id } = await signIn();
    expect((await api().get("/api/v1/seller/verification").set(bearer(token)).expect(200)).body).toEqual({ status: "none" });

    const noDoc = await api().post("/api/v1/seller/verification").set(bearer(token)).send({ idType: "nin" }).expect(400);
    expect(noDoc.body.details.fields.documentPublicId).toBeDefined();
    const stolen = await api().post("/api/v1/seller/verification").set(bearer(token)).send({ idType: "nin", documentPublicId: "gbanjo/id-documents/someone/x" }).expect(403);
    expect(stolen.body.code).toBe("NOT_YOUR_UPLOAD");
    await api().post("/api/v1/seller/verification").set(bearer(token)).send({ idType: "selfie" }).expect(400);

    const sent = await verify(token, id).expect(201);
    expect(sent.body).toMatchObject({ status: "pending", idType: "nin" });

    const admin = await signIn("admin");
    await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    await api().get("/api/v1/admin/seller-verifications").set(bearer(token)).expect(403);
    const list = await api().get("/api/v1/admin/seller-verifications?status=PENDING").set(bearer(admin.token)).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].document.url).toContain("cloudinary.com");
    await api().patch(`/api/v1/admin/seller-verifications/${list.body[0].id}`).set(bearer(admin.token)).send({ status: "VERIFIED" }).expect(200);
    expect((await api().get("/api/v1/seller/verification").set(bearer(token))).body.status).toBe("verified");
    expect((await verify(token, id).expect(409)).body.code).toBe("ALREADY_VERIFIED");
  });

  it("needs verification to list; drafts need only a category; publishing needs the essentials", async () => {
    const { token, id } = await signIn();
    const blocked = await api().post("/api/v1/seller/listings").set(bearer(token)).send({ category: "electronics" }).expect(403);
    expect(blocked.body.code).toBe("VERIFICATION_REQUIRED");
    await verify(token, id).expect(201);

    const draft = await api().post("/api/v1/seller/listings").set(bearer(token)).send({ category: "electronics" }).expect(201);
    expect(draft.body).toMatchObject({ status: "draft", title: "", category: "electronics", categoryName: "Electronics", photos: [] });
    // Drafts aren't in the shop.
    expect((await api().get("/api/v1/products").expect(200)).body.total).toBe(0);

    const incomplete = await api().patch(`/api/v1/seller/listings/${draft.body.id}`).set(bearer(token)).send({ status: "active" }).expect(400);
    expect(incomplete.body.code).toBe("LISTING_INCOMPLETE");
    expect(Object.keys(incomplete.body.details.fields).sort()).toEqual(["location", "photos", "price", "title"]);

    const foreign = await api()
      .patch(`/api/v1/seller/listings/${draft.body.id}`)
      .set(bearer(token))
      .send({ photos: ["https://res.cloudinary.com/demo/image/upload/gbanjo/listings/other/p1"] })
      .expect(400);
    expect(foreign.body.details.fields.photos).toBeDefined();
    await api().post("/api/v1/seller/listings").set(bearer(token)).send({ category: "cars" }).expect(400);
  });

  it("publishes a listing into its category, then sells / edits / deletes it", async () => {
    const { token, id } = await signIn();
    await verify(token, id).expect(201);
    const body = {
      title: "iPhone 13 Pro 256GB",
      category: "electronics",
      condition: "Like New",
      description: "Clean, no scratches.",
      brand: "Apple",
      price: 450000,
      negotiable: true,
      location: "Ikeja, Lagos",
      delivery: "i-deliver",
      photos: [photo(id, 1), photo(id, 2)],
      status: "active",
    };
    const created = await api().post("/api/v1/seller/listings").set(bearer(token)).send(body).expect(201);
    expect(created.body).toMatchObject({ status: "active", title: body.title, price: 450000, photos: body.photos, delivery: "i-deliver", negotiable: true });
    expect(created.body.slug).toMatch(/^iphone-13-pro-256gb-[a-f0-9]{6}$/);

    // In the shop: category page, search and the product page (with the seller).
    const cat = await api().get("/api/v1/products?category=electronics").expect(200);
    expect(cat.body.items.map((p: { id: string }) => p.id)).toEqual([created.body.slug]);
    const found = await api().get("/api/v1/products?q=iphone").expect(200);
    expect(found.body.total).toBe(1);
    const page = await api().get(`/api/v1/products/${created.body.slug}`).expect(200);
    expect(page.body).toMatchObject({
      name: body.title,
      image: body.photos[0],
      gallery: [body.photos[1]],
      tags: "Electronics · Like New",
      badge: { label: "New", tone: "new" },
      brand: "Apple",
      seller: { name: "Romina Williams", verified: false, address: "Ikeja, Lagos" },
    });

    // Sellers can't buy their own item; others can.
    const own = await api().post("/api/v1/cart/items").set(bearer(token)).send({ productId: created.body.slug }).expect(400);
    expect(own.body.code).toBe("OWN_LISTING");
    const buyer = await signIn("buyer");
    await api().post("/api/v1/cart/items").set(bearer(buyer.token)).send({ productId: created.body.slug }).expect(200);

    // Editing keeps the link.
    const edited = await api().patch(`/api/v1/seller/listings/${created.body.id}`).set(bearer(token)).send({ price: 420000, title: "iPhone 13 Pro" }).expect(200);
    expect(edited.body).toMatchObject({ price: 420000, slug: created.body.slug });

    // Only the owner can see or change it.
    await api().patch(`/api/v1/seller/listings/${created.body.id}`).set(bearer(buyer.token)).send({ price: 1 }).expect(404);

    // Sold: gone from the shop and from carts.
    await api().patch(`/api/v1/seller/listings/${created.body.id}`).set(bearer(token)).send({ status: "sold" }).expect(200);
    expect((await api().get("/api/v1/products?category=electronics")).body.total).toBe(0);
    expect((await api().get("/api/v1/cart").set(bearer(buyer.token))).body.items).toEqual([]);

    const mine = await api().get("/api/v1/seller/listings").set(bearer(token)).expect(200);
    expect(mine.body.map((l: { status: string }) => l.status)).toEqual(["sold"]);

    await api().delete(`/api/v1/seller/listings/${created.body.id}`).set(bearer(token)).expect(204);
    expect((await api().get("/api/v1/seller/listings").set(bearer(token))).body).toEqual([]);
  });

  it("a rejected seller can't publish until they resubmit", async () => {
    const { token, id } = await signIn();
    await verify(token, id).expect(201);
    await prisma.sellerVerification.update({ where: { userId: id }, data: { status: "REJECTED", note: "Blurry" } });
    expect((await api().get("/api/v1/seller/verification").set(bearer(token))).body).toMatchObject({ status: "rejected", note: "Blurry" });
    const res = await api().post("/api/v1/seller/listings").set(bearer(token)).send({ category: "electronics" }).expect(403);
    expect(res.body.code).toBe("VERIFICATION_REJECTED");
    await verify(token, id).expect(201);
    await api().post("/api/v1/seller/listings").set(bearer(token)).send({ category: "electronics" }).expect(201);
  });
});
