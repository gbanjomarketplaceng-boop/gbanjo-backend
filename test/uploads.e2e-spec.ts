import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "./app.factory";

/** The test environment has no Cloudinary settings: uploads answer UPLOADS_NOT_CONFIGURED. Signing itself is unit-tested. */
describe("Uploads (e2e)", () => {
  let app: INestApplication;
  let reset: () => Promise<void>;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, reset } = await createTestApp());
  });
  beforeEach(() => reset());
  afterAll(async () => {
    await app.close();
  });

  const signIn = async () =>
    (await api().post("/api/v1/auth/oauth/google").send({ idToken: "ok:g-1:romina@gmail.com" }).expect(200)).body.accessToken as string;

  it("needs a signed-in user", async () => {
    await api().post("/api/v1/uploads/signature").send({ purpose: "listing_photo" }).expect(401);
  });

  it("validates the purpose and says when uploads aren't set up", async () => {
    const token = await signIn();
    const bad = await api().post("/api/v1/uploads/signature").set("Authorization", `Bearer ${token}`).send({ purpose: "anything" }).expect(400);
    expect(bad.body.code).toBe("VALIDATION_FAILED");
    const off = await api().post("/api/v1/uploads/signature").set("Authorization", `Bearer ${token}`).send({ purpose: "listing_photo" }).expect(503);
    expect(off.body.code).toBe("UPLOADS_NOT_CONFIGURED");
  });

  it("only accepts avatars uploaded to the user's own Cloudinary folder", async () => {
    const token = await signIn();
    const res = await api()
      .patch("/api/v1/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ avatarUrl: "https://evil.example/me.png" })
      .expect(400);
    expect(res.body.code).toBe("INVALID_AVATAR");
    // Clearing the avatar is always allowed.
    await api().patch("/api/v1/users/me").set("Authorization", `Bearer ${token}`).send({ avatarUrl: null }).expect(200);
  });
});
