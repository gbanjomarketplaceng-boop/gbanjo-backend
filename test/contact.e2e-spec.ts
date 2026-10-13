import { getQueueToken } from "@nestjs/bullmq";
import type { INestApplication } from "@nestjs/common";
import type { Queue } from "bullmq";
import request from "supertest";
import { NOTIFICATIONS_QUEUE } from "../src/modules/notifications/notifications.constants";
import type { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./app.factory";

describe("Contact (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reset: () => Promise<void>;
  let queue: Queue;
  const api = () => request(app.getHttpServer());
  const valid = {
    name: "Romina Williams",
    email: "Romina@Email.com",
    topic: "Orders & delivery",
    orderRef: "GB-1029",
    subject: "Where is my order?",
    message: "Hi, my order hasn't arrived yet. Can you check it?",
  };

  beforeAll(async () => {
    ({ app, prisma, reset } = await createTestApp());
    queue = app.get<Queue>(getQueueToken(NOTIFICATIONS_QUEUE));
  });
  beforeEach(async () => {
    await reset();
    await prisma.contactMessage.deleteMany();
  });
  afterAll(async () => {
    await prisma.contactMessage.deleteMany();
    await app.close();
  });

  it("saves the message and queues the support + confirmation emails", async () => {
    const res = await api().post("/api/v1/contact").send(valid).expect(201);
    expect(res.body).toMatchObject({ message: expect.any(String), reference: expect.stringMatching(/^[A-Z0-9]{8}$/) });

    const saved = await prisma.contactMessage.findMany();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ email: "romina@email.com", topic: "Orders & delivery", orderRef: "GB-1029", status: "NEW" });

    const jobs = await queue.getJobs(["waiting", "active", "completed", "delayed"]);
    expect(jobs.some((j) => j.name === "contact-message" && j.data.id === saved[0].id)).toBe(true);
  });

  it("validates every field with per-field messages", async () => {
    const res = await api().post("/api/v1/contact").send({ name: "", email: "nope", topic: "Gossip", subject: "", message: "short" }).expect(400);
    expect(Object.keys(res.body.details.fields)).toEqual(expect.arrayContaining(["name", "email", "topic", "subject", "message"]));
  });

  it("drops bot messages caught by the honeypot without telling them", async () => {
    await api().post("/api/v1/contact").send({ ...valid, website: "http://spam.example" }).expect(201);
    expect(await prisma.contactMessage.count()).toBe(0);
  });

  it("admins can list messages and mark them resolved", async () => {
    await api().post("/api/v1/contact").send(valid).expect(201);
    const signIn = await api().post("/api/v1/auth/oauth/google").send({ idToken: "ok:a1:admin@gmail.com" }).expect(200);
    const auth = { Authorization: `Bearer ${signIn.body.accessToken}` };
    await api().get("/api/v1/admin/contact-messages").set(auth).expect(403);

    await prisma.user.update({ where: { id: signIn.body.user.id }, data: { role: "ADMIN" } });
    const list = await api().get("/api/v1/admin/contact-messages?status=NEW").set(auth).expect(200);
    expect(list.body).toHaveLength(1);
    const done = await api().patch(`/api/v1/admin/contact-messages/${list.body[0].id}`).set(auth).send({ status: "RESOLVED" }).expect(200);
    expect(done.body.status).toBe("RESOLVED");
  });
});
