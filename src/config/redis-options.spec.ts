import { parseRedisUrl } from "./redis-options";

describe("parseRedisUrl", () => {
  it("reads Render / Upstash style URLs", () => {
    expect(parseRedisUrl("redis://red-abc123:6379")).toEqual({ host: "red-abc123", port: 6379 });
    expect(parseRedisUrl("rediss://default:s%40cret@host.example.com:6380/2")).toEqual({ host: "host.example.com", port: 6380, password: "s@cret", db: 2, tls: {} });
    expect(parseRedisUrl("redis://me:pw@h:1234")).toEqual({ host: "h", port: 1234, username: "me", password: "pw" });
  });
});
