import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./app.factory";

const CODE = "1234"; // OTP_DEV_CODE in test/env.ts

/** Google/Apple are faked in app.factory: a token is `ok:<sub>:<email>`. */
describe("Social sign-in, wallet and profile completion (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  const api = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    ({ app, prisma, reset } = await createTestApp());
  });
  beforeEach(() => reset());
  afterAll(async () => {
    await app.close();
  });

  const signUpWithPhone = async (overrides: Record<string, string> = {}) => {
    const body = { firstName: "Romina", lastName: "Williams", email: "romina@gmail.com", phone: "09045654356", password: "Gbanjo2026", ...overrides };
    await api().post("/api/v1/auth/register").send(body).expect(201);
    return (await api().post("/api/v1/auth/verify-phone").send({ phone: body.phone, code: CODE }).expect(200)).body;
  };

  it("rejects a bad token", async () => {
    const res = await api().post("/api/v1/auth/oauth/google").send({ idToken: "forged" }).expect(401);
    expect(res.body.code).toBe("INVALID_OAUTH_TOKEN");
  });

  it("needs an idToken or code", async () => {
    const res = await api().post("/api/v1/auth/oauth/google").send({}).expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("new user: signed in straight away (no SMS code), with a 0.00 wallet, asked to complete the profile", async () => {
    const res = await api().post("/api/v1/auth/oauth/google").send({ idToken: "ok:g-1:romina@gmail.com" }).expect(200);
    expect(res.body).toMatchObject({
      status: "authenticated",
      requiresPasswordSetup: false,
      requiresProfileCompletion: true,
      user: { email: "romina@gmail.com", firstName: "Romina", phone: null, isEmailVerified: true, isPhoneVerified: false, isProfileComplete: false },
    });

    const wallet = await api().get("/api/v1/wallet").set(bearer(res.body.accessToken)).expect(200);
    expect(wallet.body).toMatchObject({ balance: "0.00", currency: "NGN" });

    const done = await api()
      .post("/api/v1/users/me/complete-profile")
      .set(bearer(res.body.accessToken))
      .send({ firstName: "Romina", lastName: "Williams", phone: "0904 565 4356" })
      .expect(200);
    expect(done.body).toMatchObject({ phone: "+2349045654356", isProfileComplete: true });

    const again = await api().post("/api/v1/auth/oauth/google").send({ code: "ok:g-1:romina@gmail.com" }).expect(200);
    expect(again.body).toMatchObject({ status: "authenticated", requiresProfileCompletion: false, user: { id: res.body.user.id } });
    expect(await prisma.user.count()).toBe(1);
  });

  it("links to an existing account with the same email and keeps its wallet", async () => {
    const auth = await signUpWithPhone();
    const res = await api().post("/api/v1/auth/oauth/apple").send({ idToken: "ok:a-1:romina@gmail.com" }).expect(200);
    expect(res.body).toMatchObject({ status: "authenticated", requiresProfileCompletion: false, user: { id: auth.user.id, isEmailVerified: true } });
    expect(await prisma.wallet.count()).toBe(1);

    // Apple may hide the email later: the link alone signs in.
    const noEmail = await api().post("/api/v1/auth/oauth/apple").send({ idToken: "ok:a-1:" }).expect(200);
    expect(noEmail.body.user.id).toBe(auth.user.id);
  });

  it("takes over an unfinished sign-up that used the email, wiping its password and phone", async () => {
    await api()
      .post("/api/v1/auth/register")
      .send({ firstName: "Someone", lastName: "Else", email: "romina@gmail.com", phone: "08031234567", password: "Squatter2026" })
      .expect(201);
    const res = await api().post("/api/v1/auth/oauth/google").send({ idToken: "ok:g-1:romina@gmail.com" }).expect(200);
    expect(res.body.user).toMatchObject({ firstName: "Romina", phone: null, hasPassword: false });

    // The squatter's password no longer works.
    await api().post("/api/v1/auth/login").send({ email: "romina@gmail.com", password: "Squatter2026" }).expect(401);
  });

  it("a social account blocks registering the same email again", async () => {
    await api().post("/api/v1/auth/oauth/google").send({ idToken: "ok:g-1:romina@gmail.com" }).expect(200);
    const res = await api()
      .post("/api/v1/auth/register")
      .send({ firstName: "R", lastName: "W", email: "romina@gmail.com", phone: "09045654356", password: "Gbanjo2026" })
      .expect(409);
    expect(res.body.code).toBe("EMAIL_TAKEN");
  });

  it("complete-profile refuses a phone that's verified on another account", async () => {
    await signUpWithPhone({ email: "tolu@email.com" });
    const res = await api().post("/api/v1/auth/oauth/google").send({ idToken: "ok:g-1:romina@gmail.com" }).expect(200);
    const taken = await api()
      .post("/api/v1/users/me/complete-profile")
      .set(bearer(res.body.accessToken))
      .send({ firstName: "Romina", lastName: "Williams", phone: "09045654356" })
      .expect(409);
    expect(taken.body.code).toBe("PHONE_TAKEN");

    const bad = await api()
      .post("/api/v1/users/me/complete-profile")
      .set(bearer(res.body.accessToken))
      .send({ firstName: "Romina", lastName: "Williams", phone: "123" })
      .expect(400);
    expect(bad.body.code).toBe("INVALID_PHONE");
  });

  it("a social user without a phone gets the password-reset code by email", async () => {
    await api().post("/api/v1/auth/oauth/google").send({ idToken: "ok:g-1:romina@gmail.com" }).expect(200);
    await api().post("/api/v1/auth/password/forgot").send({ email: "romina@gmail.com", channel: "sms" }).expect(202);
    const reset = await api().post("/api/v1/auth/password/verify-code").send({ email: "romina@gmail.com", code: CODE }).expect(200);
    await api().post("/api/v1/auth/password/reset").send({ resetToken: reset.body.resetToken, password: "NewPass2026" }).expect(204);
    const login = await api().post("/api/v1/auth/login").send({ email: "romina@gmail.com", password: "NewPass2026" }).expect(200);
    expect(login.body.requiresProfileCompletion).toBe(true);
  });

  it("phone sign-up gets a 0.00 wallet too", async () => {
    const auth = await signUpWithPhone();
    expect(auth.requiresProfileCompletion).toBe(false);
    const wallet = await api().get("/api/v1/wallet").set(bearer(auth.accessToken)).expect(200);
    expect(wallet.body.balance).toBe("0.00");
  });

  it("needs an email to create an account", async () => {
    const res = await api().post("/api/v1/auth/oauth/apple").send({ idToken: "ok:a-9:" }).expect(400);
    expect(res.body.code).toBe("OAUTH_EMAIL_REQUIRED");
  });

  it("blocks suspended accounts", async () => {
    const res = await api().post("/api/v1/auth/oauth/google").send({ idToken: "ok:g-1:romina@gmail.com" }).expect(200);
    await prisma.user.update({ where: { id: res.body.user.id }, data: { status: "SUSPENDED" } });
    const again = await api().post("/api/v1/auth/oauth/google").send({ idToken: "ok:g-1:romina@gmail.com" }).expect(403);
    expect(again.body.code).toBe("ACCOUNT_SUSPENDED");
  });
});
