import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp } from "./app.factory";

describe("Addresses (e2e)", () => {
  let app: INestApplication;
  let reset: () => Promise<void>;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const home = { label: "Home", name: "Romina Williams", phone: "09045654356", address: "239 Muri Okunola St, Victoria Island, Lagos" };
  const work = { label: "Work", name: "Romina Williams", phone: "+2348031112222", address: "12 Adeola Odeku St, VI, Lagos" };

  beforeAll(async () => {
    ({ app, reset } = await createTestApp());
  });
  beforeEach(() => reset());
  afterAll(() => app.close());

  const signIn = async (sub = "u1") =>
    (await api().post("/api/v1/auth/oauth/google").send({ idToken: `ok:${sub}:${sub}@gmail.com` }).expect(200)).body.accessToken as string;
  const labels = (list: { label: string; isDefault: boolean }[]) => list.map((a) => `${a.label}${a.isDefault ? "*" : ""}`);

  it("needs a signed-in user", async () => {
    await api().get("/api/v1/addresses").expect(401);
  });

  it("adds, edits, switches the default and deletes", async () => {
    const t = await signIn();
    expect((await api().get("/api/v1/addresses").set(bearer(t)).expect(200)).body).toEqual([]);

    let res = await api().post("/api/v1/addresses").set(bearer(t)).send(home).expect(201);
    expect(res.body[0]).toMatchObject({ label: "Home", phone: "+2349045654356", isDefault: true }); // first one is default
    res = await api().post("/api/v1/addresses").set(bearer(t)).send(work).expect(201);
    expect(labels(res.body)).toEqual(["Home*", "Work"]);

    const workId = res.body[1].id;
    const homeId = res.body[0].id;
    res = await api().patch(`/api/v1/addresses/${workId}`).set(bearer(t)).send({ isDefault: true }).expect(200);
    expect(labels(res.body)).toEqual(["Work*", "Home"]);

    res = await api().patch(`/api/v1/addresses/${homeId}`).set(bearer(t)).send({ address: "1 New Road, Ikeja", label: "Mum" }).expect(200);
    expect(res.body[1]).toMatchObject({ label: "Mum", address: "1 New Road, Ikeja", isDefault: false });

    const off = await api().patch(`/api/v1/addresses/${workId}`).set(bearer(t)).send({ isDefault: false }).expect(400);
    expect(off.body.code).toBe("DEFAULT_REQUIRED");

    // Deleting the default hands it to another address.
    res = await api().delete(`/api/v1/addresses/${workId}`).set(bearer(t)).expect(200);
    expect(labels(res.body)).toEqual(["Mum*"]);
    res = await api().delete(`/api/v1/addresses/${homeId}`).set(bearer(t)).expect(200);
    expect(res.body).toEqual([]);
  });

  it("validates and keeps addresses private", async () => {
    const t = await signIn();
    const bad = await api().post("/api/v1/addresses").set(bearer(t)).send({ ...home, phone: "12345" }).expect(400);
    expect(bad.body.details.fields.phone).toBeDefined();
    const empty = await api().post("/api/v1/addresses").set(bearer(t)).send({ ...home, address: "" }).expect(400);
    expect(empty.body.details.fields.address).toBeDefined();

    const mine = (await api().post("/api/v1/addresses").set(bearer(t)).send(home).expect(201)).body[0].id;
    const other = await signIn("u2");
    await api().patch(`/api/v1/addresses/${mine}`).set(bearer(other)).send({ label: "X" }).expect(404);
    await api().delete(`/api/v1/addresses/${mine}`).set(bearer(other)).expect(404);
    expect((await api().get("/api/v1/addresses").set(bearer(other))).body).toEqual([]);
  });
});
