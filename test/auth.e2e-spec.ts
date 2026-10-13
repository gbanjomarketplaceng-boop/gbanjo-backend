import type { INestApplication } from "@nestjs/common";
import type Redis from "ioredis";
import request from "supertest";
import type { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./app.factory";

const CODE = "1234"; // OTP_DEV_CODE in test/env.ts

const romina = {
  firstName: "Romina",
  lastName: "Williams",
  email: "Romina.Williams@Email.com",
  phone: "09045654356",
};

describe("Auth (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let reset: () => Promise<void>;
  const api = () => request(app.getHttpServer());

  /** Registers + verifies the phone; returns the auth response body. */
  const signUp = async (overrides: Partial<typeof romina & { password: string }> = {}) => {
    const body = { ...romina, password: "Gbanjo2026", ...overrides };
    await api().post("/api/v1/auth/register").send(body).expect(201);
    const res = await api().post("/api/v1/auth/verify-phone").send({ phone: body.phone, code: CODE }).expect(200);
    return res.body;
  };

  beforeAll(async () => {
    ({ app, prisma, redis, reset } = await createTestApp());
  });

  beforeEach(() => reset());

  afterAll(async () => {
    await app.close();
  });

  describe("sign-up", () => {
    it("validates input with per-field errors", async () => {
      const res = await api()
        .post("/api/v1/auth/register")
        .send({ firstName: "", lastName: "W", email: "nope", phone: "123", password: "short" })
        .expect(400);
      expect(res.body.code).toBe("VALIDATION_FAILED");
      expect(Object.keys(res.body.details.fields)).toEqual(expect.arrayContaining(["firstName", "email", "password"]));
    });

    it("rejects non-Nigerian phone numbers", async () => {
      const res = await api().post("/api/v1/auth/register").send({ ...romina, phone: "5551234567" }).expect(400);
      expect(res.body.code).toBe("INVALID_PHONE");
    });

    it("registers, sends a code, and signs in after the right code", async () => {
      const reg = await api().post("/api/v1/auth/register").send(romina).expect(201);
      expect(reg.body.verification).toMatchObject({ channel: "sms", destination: "+234********56", codeLength: 4 });

      const wrong = await api().post("/api/v1/auth/verify-phone").send({ phone: "+2349045654356", code: "0000" }).expect(400);
      expect(wrong.body).toMatchObject({ code: "INVALID_CODE", details: { attemptsRemaining: 4 } });

      const ok = await api().post("/api/v1/auth/verify-phone").send({ phone: romina.phone, code: CODE }).expect(200);
      expect(ok.body).toMatchObject({ tokenType: "Bearer", requiresPasswordSetup: true });
      expect(ok.body.user).toMatchObject({ email: "romina.williams@email.com", phone: "+2349045654356", isPhoneVerified: true, hasPassword: false });
      expect(ok.body.user.passwordHash).toBeUndefined();
    });

    it("lets a user without a password create one, once", async () => {
      await api().post("/api/v1/auth/register").send(romina).expect(201);
      const { body } = await api().post("/api/v1/auth/verify-phone").send({ phone: romina.phone, code: CODE }).expect(200);
      const auth = { Authorization: `Bearer ${body.accessToken}` };

      await api().post("/api/v1/auth/password/set").set(auth).send({ password: "Gbanjo2026" }).expect(204);
      const second = await api().post("/api/v1/auth/password/set").set(auth).send({ password: "Another2026" }).expect(409);
      expect(second.body.code).toBe("PASSWORD_ALREADY_SET");

      await api().post("/api/v1/auth/login").send({ email: romina.email, password: "Gbanjo2026" }).expect(200);
    });

    it("locks a code after too many wrong attempts", async () => {
      await api().post("/api/v1/auth/register").send(romina).expect(201);
      for (let i = 0; i < 4; i++) await api().post("/api/v1/auth/verify-phone").send({ phone: romina.phone, code: "9999" }).expect(400);
      const res = await api().post("/api/v1/auth/verify-phone").send({ phone: romina.phone, code: "9999" }).expect(429);
      expect(res.body.code).toBe("TOO_MANY_ATTEMPTS");
      const after = await api().post("/api/v1/auth/verify-phone").send({ phone: romina.phone, code: CODE }).expect(400);
      expect(after.body.code).toBe("CODE_EXPIRED");
    });

    it("refuses an email or phone that belongs to a verified account", async () => {
      await signUp();
      const email = await api().post("/api/v1/auth/register").send({ ...romina, phone: "08031234567" }).expect(409);
      expect(email.body.code).toBe("EMAIL_TAKEN");
      const phone = await api().post("/api/v1/auth/register").send({ ...romina, email: "other@email.com" }).expect(409);
      expect(phone.body.code).toBe("PHONE_TAKEN");
    });

    it("lets an unverified sign-up try again with corrected details", async () => {
      await api().post("/api/v1/auth/register").send(romina).expect(201);
      await api().post("/api/v1/auth/register").send({ ...romina, firstName: "Rominah" }).expect(201);
      expect(await prisma.user.count()).toBe(1);
      expect((await prisma.user.findFirst())?.firstName).toBe("Rominah");
    });
  });

  describe("login", () => {
    it("looks up an account with masked details", async () => {
      await signUp();
      const res = await api().post("/api/v1/auth/lookup").send({ email: "romina.williams@email.com" }).expect(200);
      expect(res.body).toEqual({ firstName: "Romina", avatarUrl: null, maskedPhone: "+234********56", maskedEmail: "ro***@email.com" });
      await api().post("/api/v1/auth/lookup").send({ email: "ghost@email.com" }).expect(404);
    });

    it("logs in and returns tokens", async () => {
      await signUp();
      const res = await api().post("/api/v1/auth/login").send({ email: romina.email, password: "Gbanjo2026" }).expect(200);
      expect(res.body).toMatchObject({ tokenType: "Bearer", requiresPasswordSetup: false });
      const me = await api().get("/api/v1/users/me").set("Authorization", `Bearer ${res.body.accessToken}`).expect(200);
      expect(me.body.firstName).toBe("Romina");
    });

    it("counts down wrong passwords, then locks the account", async () => {
      await signUp();
      const first = await api().post("/api/v1/auth/login").send({ email: romina.email, password: "Wrong2026" }).expect(401);
      expect(first.body).toMatchObject({ code: "INVALID_CREDENTIALS", details: { attemptsRemaining: 2 } });
      await api().post("/api/v1/auth/login").send({ email: romina.email, password: "Wrong2026" }).expect(401);
      const locked = await api().post("/api/v1/auth/login").send({ email: romina.email, password: "Wrong2026" }).expect(429);
      expect(locked.body.code).toBe("ACCOUNT_LOCKED");
      // Even the right password is refused while locked.
      await api().post("/api/v1/auth/login").send({ email: romina.email, password: "Gbanjo2026" }).expect(429);
    });

    it("gives the same answer for unknown emails", async () => {
      const res = await api().post("/api/v1/auth/login").send({ email: "ghost@email.com", password: "Gbanjo2026" }).expect(401);
      expect(res.body.code).toBe("INVALID_CREDENTIALS");
    });

    it("asks unverified users to verify their phone", async () => {
      await api().post("/api/v1/auth/register").send({ ...romina, password: "Gbanjo2026" }).expect(201);
      const res = await api().post("/api/v1/auth/login").send({ email: romina.email, password: "Gbanjo2026" }).expect(403);
      expect(res.body).toMatchObject({ code: "PHONE_NOT_VERIFIED", details: { phone: "+2349045654356" } });
    });
  });

  describe("sessions", () => {
    it("rotates refresh tokens and flags a just-used token", async () => {
      const first = await signUp();
      const second = await api().post("/api/v1/auth/refresh").send({ refreshToken: first.refreshToken }).expect(200);
      expect(second.body.refreshToken).not.toBe(first.refreshToken);
      expect(second.body.user.email).toBe("romina.williams@email.com");

      const replay = await api().post("/api/v1/auth/refresh").send({ refreshToken: first.refreshToken }).expect(401);
      expect(replay.body.code).toBe("TOKEN_ROTATED");

      await api().post("/api/v1/auth/refresh").send({ refreshToken: second.body.refreshToken }).expect(200);
    });

    it("revokes the whole session when an old refresh token is reused later", async () => {
      const first = await signUp();
      const second = await api().post("/api/v1/auth/refresh").send({ refreshToken: first.refreshToken }).expect(200);
      // Pretend the rotation happened a minute ago (past the grace window).
      await prisma.session.updateMany({ data: { rotatedAt: new Date(Date.now() - 60_000) } });

      const stolen = await api().post("/api/v1/auth/refresh").send({ refreshToken: first.refreshToken }).expect(401);
      expect(stolen.body.code).toBe("INVALID_REFRESH_TOKEN");
      await api().post("/api/v1/auth/refresh").send({ refreshToken: second.body.refreshToken }).expect(401);
      await api().get("/api/v1/users/me").set("Authorization", `Bearer ${second.body.accessToken}`).expect(401);
    });

    it("logout kills the access token straight away", async () => {
      const auth = await signUp();
      await api().post("/api/v1/auth/logout").send({ refreshToken: auth.refreshToken }).expect(204);
      await api().get("/api/v1/users/me").set("Authorization", `Bearer ${auth.accessToken}`).expect(401);
      await api().post("/api/v1/auth/refresh").send({ refreshToken: auth.refreshToken }).expect(401);
      // Logging out twice is fine.
      await api().post("/api/v1/auth/logout").send({ refreshToken: auth.refreshToken }).expect(204);
    });

    it("rejects requests without a valid token", async () => {
      const res = await api().get("/api/v1/users/me").expect(401);
      expect(res.body.code).toBe("UNAUTHORIZED");
      await api().get("/api/v1/users/me").set("Authorization", "Bearer not-a-jwt").expect(401);
    });
  });

  describe("passwords", () => {
    it("resets a forgotten password and signs out every device", async () => {
      const auth = await signUp();
      const forgot = await api().post("/api/v1/auth/password/forgot").send({ email: romina.email, channel: "sms" }).expect(202);
      expect(forgot.body.codeLength).toBe(4);

      const { body } = await api().post("/api/v1/auth/password/verify-code").send({ email: romina.email, code: CODE }).expect(200);
      await api().post("/api/v1/auth/password/reset").send({ resetToken: body.resetToken, password: "NewPass2026" }).expect(204);

      // Reset tokens are single-use.
      const reuse = await api().post("/api/v1/auth/password/reset").send({ resetToken: body.resetToken, password: "NewPass2026" }).expect(400);
      expect(reuse.body.code).toBe("INVALID_RESET_TOKEN");

      await api().get("/api/v1/users/me").set("Authorization", `Bearer ${auth.accessToken}`).expect(401);
      await api().post("/api/v1/auth/login").send({ email: romina.email, password: "Gbanjo2026" }).expect(401);
      await api().post("/api/v1/auth/login").send({ email: romina.email, password: "NewPass2026" }).expect(200);
    });

    it("answers forgot-password the same way for unknown emails", async () => {
      const res = await api().post("/api/v1/auth/password/forgot").send({ email: "ghost@email.com", channel: "email" }).expect(202);
      expect(res.body.message).toMatch(/If an account exists/);
    });

    it("changes the password and signs out other devices only", async () => {
      await signUp();
      const phone = await api().post("/api/v1/auth/login").send({ email: romina.email, password: "Gbanjo2026" }).expect(200);
      const laptop = await api().post("/api/v1/auth/login").send({ email: romina.email, password: "Gbanjo2026" }).expect(200);

      const wrong = await api()
        .post("/api/v1/auth/password/change")
        .set("Authorization", `Bearer ${phone.body.accessToken}`)
        .send({ currentPassword: "Nope2026x", newPassword: "Changed2026" })
        .expect(400);
      expect(wrong.body.code).toBe("INVALID_PASSWORD");

      await api()
        .post("/api/v1/auth/password/change")
        .set("Authorization", `Bearer ${phone.body.accessToken}`)
        .send({ currentPassword: "Gbanjo2026", newPassword: "Changed2026" })
        .expect(204);

      await api().get("/api/v1/users/me").set("Authorization", `Bearer ${phone.body.accessToken}`).expect(200);
      await api().get("/api/v1/users/me").set("Authorization", `Bearer ${laptop.body.accessToken}`).expect(401);
    });
  });

  describe("profile", () => {
    it("updates name and email, and refuses an email that's taken", async () => {
      const auth = await signUp();
      await signUp({ email: "tolu@email.com", phone: "08031234567", firstName: "Tolu" });
      const header = { Authorization: `Bearer ${auth.accessToken}` };

      const res = await api().patch("/api/v1/users/me").set(header).send({ firstName: " Rominah ", email: "NEW@email.com" }).expect(200);
      expect(res.body).toMatchObject({ firstName: "Rominah", email: "new@email.com", isEmailVerified: false });

      const taken = await api().patch("/api/v1/users/me").set(header).send({ email: "tolu@email.com" }).expect(409);
      expect(taken.body.code).toBe("EMAIL_TAKEN");

      const phone = await api().patch("/api/v1/users/me").set(header).send({ phone: "08000000000" }).expect(400);
      expect(phone.body.code).toBe("VALIDATION_FAILED");
    });
  });

  it("keeps OTPs out of Postgres", async () => {
    await api().post("/api/v1/auth/register").send(romina).expect(201);
    const keys = await redis.keys("otp:signup:*");
    expect(keys.length).toBeGreaterThan(0);
    expect(await redis.get(keys.find((k) => !k.includes("cooldown") && !k.includes("sends"))!)).not.toContain(CODE);
  });
});
