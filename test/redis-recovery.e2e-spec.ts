import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { LocksService } from "../src/common/idempotency/locks.service";
import type { PrismaService } from "../src/prisma/prisma.service";
import { KvService } from "../src/redis/kv.service";
import { createTestApp } from "./app.factory";

const CODE = "1234"; // OTP_DEV_CODE in test/env.ts
const tolu = { firstName: "Tolu", lastName: "Ade", email: "tolu.recovery@email.com", phone: "09045650002", password: "Gbanjo2026" };

/** Redis fails in the middle of things, then comes back: nothing saved to the database meanwhile is lost. */
describe("Redis outage and recovery (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let kv: KvService;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma, reset } = await createTestApp());
    kv = app.get(KvService);
  });
  beforeEach(() => reset());
  afterEach(() => kv.simulateOutage(0));
  afterAll(() => app.close());

  it("a code sent during an outage still works after Redis is back", async () => {
    kv.simulateOutage(60_000);
    await api().post("/api/v1/auth/register").send(tolu).expect(201);
    expect(await prisma.kvEntry.count({ where: { key: { startsWith: "otp:signup:" } } })).toBe(1);

    kv.simulateOutage(0); // Redis is back
    // A wrong guess is counted on the database copy, then the right code works once.
    expect((await api().post("/api/v1/auth/verify-phone").send({ phone: tolu.phone, code: "0000" }).expect(400)).body.details.attemptsRemaining).toBe(4);
    await api().post("/api/v1/auth/verify-phone").send({ phone: tolu.phone, code: CODE }).expect(200);
    expect(await prisma.kvEntry.count({ where: { key: { startsWith: "otp:signup:" } } })).toBe(0);
  });

  it("a lock taken during an outage still blocks after Redis is back", async () => {
    const locks = app.get(LocksService);
    kv.simulateOutage(60_000);
    let release!: () => void;
    const first = locks.withLock("withdraw:u1", () => new Promise<void>((r) => (release = r)));
    await new Promise((r) => setTimeout(r, 50));
    kv.simulateOutage(0);
    await expect(locks.withLock("withdraw:u1", async () => "x")).rejects.toMatchObject({ code: "REQUEST_IN_PROGRESS" });
    release();
    await first;
    expect(await locks.withLock("withdraw:u1", async () => "free")).toBe("free");
  });

  it("a one-time key and counters keep their values across the switch", async () => {
    kv.simulateOutage(60_000);
    await kv.set("pwreset:abc", "user-1", 600);
    expect(await kv.incr("count:x", 60)).toBe(1);
    expect(await kv.incr("count:x", 60)).toBe(2);
    expect(await kv.ttl("count:x")).toBeGreaterThan(50);
    kv.simulateOutage(0);
    expect(await kv.getDel("pwreset:abc")).toBe("user-1");
    expect(await kv.getDel("pwreset:abc")).toBeNull();
  });

  it("parallel claims on the database copy: exactly one wins", async () => {
    kv.simulateOutage(60_000);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => kv.setIfAbsent("claim:k", String(i), 30_000)));
    expect(results.filter(Boolean)).toHaveLength(1);
    const counts = await Promise.all(Array.from({ length: 20 }, () => kv.incr("count:parallel", 60)));
    expect(new Set(counts).size).toBe(20);
    expect(Math.max(...counts)).toBe(20);
  });
});
