import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** URL-safe random token with `bytes` of entropy. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Cryptographically random numeric code, e.g. "0427". */
export const randomDigits = (length: number) => Array.from({ length }, () => randomInt(0, 10)).join("");

/** Constant-time comparison of two hex strings. */
export function safeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
