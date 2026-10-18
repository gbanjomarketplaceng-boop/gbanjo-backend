/**
 * Deletes ALL products/listings, plus what belongs to them: cart and wishlist entries, reviews,
 * chats started from a listing, and reports about listings. Users, categories, banners, wallets,
 * vouchers and orders stay (old orders keep their own copy of the item name, price and photo).
 *
 *   npx ts-node --transpile-only prisma/clear-products.ts          → shows what would be deleted
 *   npx ts-node --transpile-only prisma/clear-products.ts --yes    → deletes it (cannot be undone)
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgConnectionString } from "../src/prisma/database-url";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: pgConnectionString(process.env.DATABASE_URL!) }) });

async function main() {
  const counts = {
    products: await prisma.product.count(),
    cartItems: await prisma.cartItem.count(),
    wishlistItems: await prisma.wishlistItem.count(),
    reviews: await prisma.review.count(),
    chats: await prisma.conversation.count({ where: { productId: { not: null } } }),
    reports: await prisma.report.count({ where: { productId: { not: null } } }),
  };
  console.table(counts);

  if (!process.argv.includes("--yes")) {
    console.log("Nothing deleted. Run again with --yes to delete all of the above.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.report.deleteMany({ where: { productId: { not: null } } });
    await tx.conversation.deleteMany({ where: { productId: { not: null } } }); // messages go with them
    await tx.cartItem.deleteMany({});
    await tx.wishlistItem.deleteMany({});
    await tx.review.deleteMany({});
    await tx.product.deleteMany({});
  }, { timeout: 60_000 });

  console.log(`Deleted ${counts.products} products and everything attached to them.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
