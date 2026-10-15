/**
 * node-postgres currently treats sslmode=prefer|require|verify-ca as verify-full (full certificate check)
 * and warns that the next major version will switch them to the weaker libpq meanings. Render's database
 * URLs use sslmode=require, so we spell out verify-full: the same behaviour as today, no warning, and no
 * silent downgrade when pg v9 arrives. Other URLs (no sslmode, verify-full, uselibpqcompat) are left as they are.
 */
export function pgConnectionString(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const mode = parsed.searchParams.get("sslmode");
  if (!mode || !["prefer", "require", "verify-ca"].includes(mode) || parsed.searchParams.get("uselibpqcompat") === "true") return url;
  parsed.searchParams.set("sslmode", "verify-full");
  return parsed.toString();
}
