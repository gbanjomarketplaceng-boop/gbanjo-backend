import { Logger, type INestApplication } from "@nestjs/common";
import { createSwaggerDocument } from "../src/config/swagger";
import { createTestApp } from "./app.factory";

/** The API docs must build without "Duplicate DTO" warnings (they become errors in the next @nestjs/swagger major). */
describe("API docs (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });

  it("builds the OpenAPI document with unique schema names", () => {
    const warn = jest.spyOn(Logger, "warn");
    const doc = createSwaggerDocument(app);
    const duplicates = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("Duplicate DTO"));
    warn.mockRestore();
    expect(duplicates).toEqual([]);
    expect(Object.keys(doc.components?.schemas ?? {}).length).toBeGreaterThan(20);
  });
});
