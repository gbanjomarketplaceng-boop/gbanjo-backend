import { pgConnectionString } from "./database-url";

describe("pgConnectionString", () => {
  it("spells out verify-full for the modes pg treats as verify-full", () => {
    for (const mode of ["prefer", "require", "verify-ca"])
      expect(pgConnectionString(`postgresql://u:p@db.render.com:5432/gbanjo?sslmode=${mode}`)).toBe("postgresql://u:p@db.render.com:5432/gbanjo?sslmode=verify-full");
  });

  it("leaves other URLs alone", () => {
    for (const url of [
      "postgresql://u:p@dpg-x-a/gbanjo",
      "postgresql://u:p@host/db?sslmode=disable",
      "postgresql://u:p@host/db?sslmode=verify-full",
      "postgresql://u:p@host/db?uselibpqcompat=true&sslmode=require",
    ])
      expect(pgConnectionString(url)).toBe(url);
  });

  it("keeps other parameters and special characters in the password", () => {
    expect(pgConnectionString("postgresql://u:p%40ss@host/db?connection_limit=5&sslmode=require")).toBe("postgresql://u:p%40ss@host/db?connection_limit=5&sslmode=verify-full");
  });
});
