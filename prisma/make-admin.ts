/**
 * Gives an account admin rights (e.g. to manage home-page banners at /admin/banners).
 *   npm run make-admin -- someone@email.com            (or --revoke to make them a normal user again)
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgConnectionString } from "../src/prisma/database-url";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: pgConnectionString(process.env.DATABASE_URL!) }) });

async function main() {
  const email = process.argv.find((a) => a.includes("@"))?.trim().toLowerCase();
  const revoke = process.argv.includes("--revoke");
  if (!email) throw new Error("Usage: npm run make-admin -- someone@email.com [--revoke]");
  const user = await prisma.user.update({ where: { email }, data: { role: revoke ? "USER" : "ADMIN" } }).catch(() => null);
  if (!user) throw new Error(`No account with the email ${email}. Sign up first, then run this again.`);
  console.log(`${user.email} is now ${user.role === "ADMIN" ? "an admin" : "a normal user"}.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
