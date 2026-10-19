/**
 * Gives an account admin rights (the admin panel is at /admin on the website).
 *   npm run make-admin -- someone@email.com                  → super admin (everything)
 *   npm run make-admin -- someone@email.com --role finance   → finance | support | catalog | super
 *   npm run make-admin -- someone@email.com --revoke         → a normal user again
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgConnectionString } from "../src/prisma/database-url";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: pgConnectionString(process.env.DATABASE_URL!) }) });

async function main() {
  const email = process.argv.find((a) => a.includes("@"))?.trim().toLowerCase();
  const revoke = process.argv.includes("--revoke");
  const roleArg = (process.argv[process.argv.indexOf("--role") + 1] ?? "super").toUpperCase();
  const adminRole = process.argv.includes("--role") ? roleArg : "SUPER";
  if (!["SUPER", "FINANCE", "SUPPORT", "CATALOG"].includes(adminRole)) throw new Error("--role must be super, finance, support or catalog");
  if (!email) throw new Error("Usage: npm run make-admin -- someone@email.com [--revoke]");
  const user = await prisma.user.update({ where: { email }, data: revoke ? { role: "USER", adminRole: null } : { role: "ADMIN", adminRole: adminRole as "SUPER" | "FINANCE" | "SUPPORT" | "CATALOG" } }).catch(() => null);
  if (!user) throw new Error(`No account with the email ${email}. Sign up first, then run this again.`);
  console.log(`${user.email} is now ${user.role === "ADMIN" ? `an admin (${String(user.adminRole).toLowerCase()})` : "a normal user"}.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
