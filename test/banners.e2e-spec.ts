import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./app.factory";

const HOUR = 3_600_000;

describe("Banners (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    ({ app, prisma, reset } = await createTestApp());
  });
  beforeEach(async () => {
    await reset();
    await prisma.banner.deleteMany();
  });
  afterAll(async () => {
    await prisma.banner.deleteMany();
    await app.close();
  });

  const signIn = async (sub: string, admin = false) => {
    const res = await api().post("/api/v1/auth/oauth/google").send({ idToken: `ok:${sub}:${sub}@gmail.com` }).expect(200);
    if (admin) await prisma.user.update({ where: { id: res.body.user.id }, data: { role: "ADMIN" } });
    return res.body.accessToken as string;
  };

  it("lists only live banners, in order", async () => {
    const now = Date.now();
    await prisma.banner.createMany({
      data: [
        { title: "Second", imageUrl: "/b.png", sortOrder: 2 },
        { title: "First", imageUrl: "/a.png", sortOrder: 1 },
        { title: "Hidden", imageUrl: "/c.png", isActive: false },
        { title: "Later", imageUrl: "/d.png", startsAt: new Date(now + HOUR) },
        { title: "Over", imageUrl: "/e.png", endsAt: new Date(now - HOUR) },
      ],
    });
    const res = await api().get("/api/v1/banners").expect(200);
    expect(res.body.map((b: { title: string }) => b.title)).toEqual(["First", "Second"]);
    expect(res.body[0]).toMatchObject({ image: "/a.png", backgroundColor: "#f8b91b" });

    const home = await api().get("/api/v1/catalog/home").expect(200);
    expect(home.body.banners.map((b: { title: string }) => b.title)).toEqual(["First", "Second"]);
  });

  it("only admins can manage banners or upload banner images", async () => {
    const user = await signIn("u1");
    await api().get("/api/v1/admin/banners").set(bearer(user)).expect(403);
    const res = await api().post("/api/v1/admin/banners").set(bearer(user)).send({ title: "X", imageUrl: "/x.png" }).expect(403);
    expect(res.body.code).toBe("ADMIN_ONLY");
    const up = await api().post("/api/v1/uploads/signature").set(bearer(user)).send({ purpose: "banner" }).expect(403);
    expect(up.body.code).toBe("ADMIN_ONLY");
    await api().get("/api/v1/admin/banners").expect(401);
  });

  it("admin: create, edit, schedule, hide and delete", async () => {
    const admin = await signIn("a1", true);
    const created = await api()
      .post("/api/v1/admin/banners")
      .set(bearer(admin))
      .send({ eyebrow: "New", title: "Back to school", highlight: "From ₦2,000", ctaLabel: "Shop", ctaHref: "/products?category=clothing", imageUrl: "/images/big-sale.png", backgroundColor: "#06452a" })
      .expect(201);
    expect(created.body).toMatchObject({ title: "Back to school", isActive: true, isLive: true, sortOrder: 0 });

    const edited = await api().patch(`/api/v1/admin/banners/${created.body.id}`).set(bearer(admin)).send({ title: "Back to school sale", subtitle: "" }).expect(200);
    expect(edited.body).toMatchObject({ title: "Back to school sale", subtitle: null });

    const hidden = await api().patch(`/api/v1/admin/banners/${created.body.id}`).set(bearer(admin)).send({ isActive: false }).expect(200);
    expect(hidden.body.isLive).toBe(false);
    expect((await api().get("/api/v1/banners").expect(200)).body).toEqual([]);

    const all = await api().get("/api/v1/admin/banners").set(bearer(admin)).expect(200);
    expect(all.body).toHaveLength(1);

    await api().delete(`/api/v1/admin/banners/${created.body.id}`).set(bearer(admin)).expect(204);
    await api().delete(`/api/v1/admin/banners/${created.body.id}`).set(bearer(admin)).expect(404);
  });

  it("admin: validates links, colours, schedule and images", async () => {
    const admin = await signIn("a1", true);
    const bad = await api()
      .post("/api/v1/admin/banners")
      .set(bearer(admin))
      .send({ title: "", imageUrl: "/x.png", ctaHref: "javascript:alert(1)", backgroundColor: "yellow" })
      .expect(400);
    expect(Object.keys(bad.body.details.fields)).toEqual(expect.arrayContaining(["title", "ctaHref", "backgroundColor"]));

    const foreign = await api().post("/api/v1/admin/banners").set(bearer(admin)).send({ title: "X", imageUrl: "https://evil.example/x.png" }).expect(400);
    expect(foreign.body.code).toBe("INVALID_IMAGE");

    const schedule = await api()
      .post("/api/v1/admin/banners")
      .set(bearer(admin))
      .send({ title: "X", imageUrl: "/x.png", startsAt: "2026-12-10T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" })
      .expect(400);
    expect(schedule.body.code).toBe("INVALID_SCHEDULE");
  });
});
