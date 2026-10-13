import type { INestApplication } from "@nestjs/common";
import { createSwaggerDocument } from "../src/config/swagger";
import { createTestApp } from "./app.factory";

describe("Swagger docs", () => {
  let app: INestApplication;
  beforeAll(async () => {
    ({ app } = await createTestApp());
  });
  afterAll(() => app.close());

  it("documents every route, marks public ones, and shares the error schema", () => {
    const doc = createSwaggerDocument(app);
    const ops = Object.entries(doc.paths).flatMap(([path, item]) =>
      (["get", "post", "put", "patch", "delete"] as const).flatMap((m) => (item[m] ? [{ key: `${m.toUpperCase()} ${path}`, op: item[m] }] : [])),
    );
    expect(ops.length).toBeGreaterThan(50);
    const security = (key: string) => ops.find((o) => o.key === key)?.op.security;
    expect(security("POST /api/v1/auth/login")).toEqual([]);
    expect(security("GET /api/v1/products")).toEqual([]);
    expect(security("GET /api/v1/cart")).toEqual([{ bearer: [] }]);
    expect(security("POST /api/v1/seller/listings")).toEqual([{ bearer: [] }]);
    for (const { key, op } of ops) {
      expect([key, op.tags?.length ?? 0]).not.toEqual([key, 0]);
      expect([key, !!op.summary]).toEqual([key, true]);
      expect(op.responses["400"]).toBeDefined();
    }
    expect(doc.components?.schemas?.ErrorResponseDto).toBeDefined();
  });
});
