import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { PrismaService } from "../src/prisma/prisma.service";

// Point the API at a Redis that isn't there (set before the app module is loaded).
process.env.REDIS_URL = "redis://127.0.0.1:6399/0";
process.env.OTP_RESEND_COOLDOWN_SECONDS = "60";

const CODE = "1234"; // OTP_DEV_CODE in test/env.ts
const ada = { firstName: "Ada", lastName: "Obi", email: "ada.outage@email.com", phone: "09045650001", password: "Gbanjo2026" };

/** With Redis completely unreachable, everything that needs it falls back to the database. */
describe("Redis down: database fallback (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const { createTestApp } = await import("./app.factory");
    ({ app, prisma } = await createTestApp());
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "sessions", "users", "kv_entries" CASCADE');
  }, 30_000);

  afterAll(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "sessions", "users", "kv_entries" CASCADE');
    // Shutting down must not hang while Redis is unreachable.
    const t0 = Date.now();
    await app.close();
    expect(Date.now() - t0).toBeLessThan(10_000);
  }, 30_000);

  it("health stays OK and says Redis is on the fallback", async () => {
    const res = await api().get("/api/health").expect(200);
    expect(res.body).toMatchObject({ status: "ok", database: "up", redis: "fallback" });
  });

  it("sign-up codes, login, wrong-password limits and password reset all work", async () => {
    const t0 = Date.now();
    await api().post("/api/v1/auth/register").send(ada).expect(201);
    // Asking again straight away hits the resend cooldown (kept in the database).
    expect((await api().post("/api/v1/auth/resend-otp").send({ phone: ada.phone }).expect(429)).body.code).toBe("OTP_COOLDOWN");
    // Wrong code counts an attempt; right code works once.
    expect((await api().post("/api/v1/auth/verify-phone").send({ phone: ada.phone, code: "0000" }).expect(400)).body.details.attemptsRemaining).toBe(4);
    const auth = (await api().post("/api/v1/auth/verify-phone").send({ phone: ada.phone, code: CODE }).expect(200)).body;
    await api().post("/api/v1/auth/verify-phone").send({ phone: ada.phone, code: CODE }).expect(409); // already verified
    // Fast: no waiting on Redis.
    expect(Date.now() - t0).toBeLessThan(15_000);

    // Signed-in requests work (session cache skipped).
    await api().get("/api/v1/users/me").set("Authorization", `Bearer ${auth.accessToken}`).expect(200);

    // Wrong passwords are still counted.
    const first = await api().post("/api/v1/auth/login").send({ email: ada.email, password: "Wrong2026" }).expect(401);
    const second = await api().post("/api/v1/auth/login").send({ email: ada.email, password: "Wrong2026" }).expect(401);
    expect(second.body.details.attemptsRemaining).toBe(first.body.details.attemptsRemaining - 1);
    await api().post("/api/v1/auth/login").send({ email: ada.email, password: ada.password }).expect(200);

    // Password reset: code → one-use token → new password.
    await api().post("/api/v1/auth/password/forgot").send({ email: ada.email, channel: "sms" }).expect(202);
    const { resetToken } = (await api().post("/api/v1/auth/password/verify-code").send({ email: ada.email, code: CODE }).expect(200)).body;
    // The code is used up.
    expect((await api().post("/api/v1/auth/password/verify-code").send({ email: ada.email, code: CODE }).expect(400)).body.code).toBe("CODE_EXPIRED");
    await api().post("/api/v1/auth/password/reset").send({ resetToken, password: "NewPass2026" }).expect(204);
    await api().post("/api/v1/auth/password/reset").send({ resetToken, password: "NewPass2026" }).expect(400);
    await api().post("/api/v1/auth/login").send({ email: ada.email, password: "NewPass2026" }).expect(200);

    expect(await prisma.kvEntry.count()).toBeGreaterThan(0);
  });

  it("locks and request keys still stop double actions", async () => {
    const { LocksService } = await import("../src/common/idempotency/locks.service");
    const locks = app.get(LocksService);
    let release!: () => void;
    const first = locks.withLock("pay:test", () => new Promise<string>((r) => (release = () => r("done"))));
    await new Promise((r) => setTimeout(r, 50));
    await expect(locks.withLock("pay:test", async () => "second")).rejects.toMatchObject({ code: "REQUEST_IN_PROGRESS" });
    release();
    expect(await first).toBe("done");
    // Released: free again.
    expect(await locks.withLock("pay:test", async () => "again")).toBe("again");
  });

  it("rate limiting falls back to counting in memory", async () => {
    const { ResilientThrottlerStorage } = await import("../src/common/throttle/resilient-throttler.storage");
    const { KvService } = await import("../src/redis/kv.service");
    const { REDIS } = await import("../src/redis/redis.constants");
    const storage = new ResilientThrottlerStorage(app.get(REDIS), app.get(KvService));
    const a = await storage.increment("ip:1", 60_000, 2, 60_000, "default");
    const b = await storage.increment("ip:1", 60_000, 2, 60_000, "default");
    const c = await storage.increment("ip:1", 60_000, 2, 60_000, "default");
    expect([a.totalHits, b.totalHits, c.isBlocked]).toEqual([1, 2, true]);
    storage.onApplicationShutdown();
  });
});
