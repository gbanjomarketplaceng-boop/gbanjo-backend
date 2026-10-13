/**
 * Fills the catalog with the storefront's starter categories and products (the ones the designs show).
 * Safe to run again: rows are matched by slug and updated; flash-sale end dates are pushed a week ahead.
 *   npx prisma db seed        (or: npm run prisma:seed)
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const DAY = 86_400_000;
const LAGOS = "Lagos, Nigeria";

const categories = [
  { slug: "home-decor", name: "Home Decor", blurb: "Furniture & everyday living", imageUrl: "/images/cat-home-decor.png" },
  { slug: "electronics", name: "Electronics", blurb: "Devices & accessories", imageUrl: "/images/cat-electronics.png" },
  { slug: "vehicles", name: "Vehicles", blurb: "Cars, bikes & parts", imageUrl: "/images/cat-vehicles.png" },
  { slug: "properties", name: "Properties", blurb: "Find your next space", imageUrl: "/images/cat-properties.png" },
  { slug: "clothing", name: "Clothing", blurb: "Style for every day", imageUrl: "/images/cat-clothing.png" },
  // More categories sellers can list in (the home sidebar shows the first five).
  { slug: "phones-tablets", name: "Phones & Tablets", blurb: "Phones, tablets & accessories", imageUrl: "/images/cat-phones-tablets.png" },
  { slug: "beauty", name: "Beauty", blurb: "Skincare, makeup & fragrance", imageUrl: "/images/cat-beauty.png" },
  { slug: "groceries", name: "Groceries", blurb: "Food & household essentials", imageUrl: "/images/cat-groceries.png" },
  { slug: "sports", name: "Sports", blurb: "Fitness & outdoor gear", imageUrl: "/images/cat-sports.png" },
  { slug: "jobs-services", name: "Jobs & Services", blurb: "Hire help or offer your skills", imageUrl: "/images/cat-jobs-services.png" },
  { slug: "other", name: "Other", blurb: "Everything else", imageUrl: "/images/cat-other.png" },
];

type Seed = {
  slug: string;
  name: string;
  imageUrl: string;
  price: number;
  oldPrice?: number;
  category: string;
  tags: string;
  /** Design mock numbers; not saved (ratings come from real reviews). */
  rating?: number;
  reviewCount?: number;
  gallery?: string[];
  variations?: string[];
  condition?: string;
  /** "flash" = in the flash sale, "new" = listed in the last few days, "featured" = boosted in Just For You. */
  kind?: "flash" | "new" | "featured";
};

const products: Seed[] = [
  // Flash sale
  { kind: "flash", slug: "olive-low-top-sneakers", name: "Olive low-top sneakers", imageUrl: "/images/l-olive-sneakers.png", price: 17000, oldPrice: 21250, category: "clothing", tags: "Clothing · Footwear", rating: 4, reviewCount: 20 },
  {
    kind: "flash",
    slug: "textured-lace-up-sneakers",
    name: "Nike Air Force 1 Luxe ‘Olive Green’ Sneakers",
    imageUrl: "/images/pd-sneaker.png",
    gallery: ["/images/pd-photo-1.png", "/images/pd-photo-2.png", "/images/pd-photo-1.png", "/images/pd-photo-1.png"],
    price: 17000,
    oldPrice: 24300,
    category: "clothing",
    tags: "Clothing · Footwear",
    rating: 4,
    reviewCount: 32,
    variations: ["Black", "M"],
  },
  { kind: "flash", slug: "marble-top-dining-set", name: "Marble-top dining set", imageUrl: "/images/l-marble-dining.png", price: 32000, oldPrice: 40000, category: "home-decor", tags: "Home Decor · Furniture", rating: 4, reviewCount: 9 },

  // New items
  { kind: "new", slug: "oraimo-portable-power-bank", name: "Oraimo portable power bank", imageUrl: "/images/l-power-bank.png", price: 17000, category: "electronics", tags: "Electronics · Accessories", rating: 5, reviewCount: 14, condition: "20,000mAh · New" },
  { kind: "new", slug: "classic-round-face-wristwatches", name: "Classic round-face wristwatches", imageUrl: "/images/l-wristwatches.png", price: 32000, category: "clothing", tags: "Clothing · Accessories", rating: 4, reviewCount: 11, condition: "One size · New" },
  { kind: "new", slug: "white-everyday-sneakers", name: "White everyday sneakers", imageUrl: "/images/l-white-sneakers.png", price: 21000, category: "clothing", tags: "Clothing · Footwear", rating: 4, reviewCount: 6 },

  // Just for you
  { kind: "featured", slug: "spacious-duplex-with-balcony", name: "Spacious duplex with balcony", imageUrl: "/images/l-duplex-balcony.png", price: 17000, category: "properties", tags: "Properties", rating: 5, reviewCount: 4 },
  { kind: "featured", slug: "modern-detached-home", name: "Modern detached home", imageUrl: "/images/l-detached-home.png", price: 17000, category: "properties", tags: "Properties", rating: 4, reviewCount: 7 },
  { kind: "featured", slug: "contemporary-family-duplex", name: "Contemporary family duplex", imageUrl: "/images/l-family-duplex.png", price: 17000, category: "properties", tags: "Properties", rating: 4, reviewCount: 3 },
  { kind: "featured", slug: "terraced-home-with-a-courtyard", name: "Terraced home with a courtyard", imageUrl: "/images/l-terraced-home.png", price: 17000, category: "properties", tags: "Properties", rating: 5, reviewCount: 5 },

  // More clothing
  { slug: "everyday-white-blouse", name: "Everyday white blouse", imageUrl: "/images/w-white-blouse.png", price: 2400, category: "clothing", tags: "Clothing · Tops", rating: 4, reviewCount: 5, condition: "Size S · Like new" },
  { slug: "sunshine-summer-top", name: "Sunshine summer top", imageUrl: "/images/w-summer-top.png", price: 1800, category: "clothing", tags: "Clothing · Tops", rating: 4, reviewCount: 3, condition: "Size M · New with tags" },
  { slug: "cozy-pink-sweatshirt", name: "Cozy pink sweatshirt", imageUrl: "/images/w-pink-sweatshirt.png", price: 3200, category: "clothing", tags: "Clothing · Tops", rating: 5, reviewCount: 8, condition: "Size M · Very good" },
  { slug: "classic-straight-jeans", name: "Classic straight jeans", imageUrl: "/images/w-straight-jeans.png", price: 2800, category: "clothing", tags: "Clothing · Bottoms", rating: 4, reviewCount: 6, condition: "Size 28 · Like new" },
  { slug: "grey-canvas-sneakers", name: "Grey canvas lace-up sneakers", imageUrl: "/images/sim-1.png", price: 17000, category: "clothing", tags: "Clothing · Footwear", rating: 4, reviewCount: 20 },
  { slug: "black-slip-on-sneakers", name: "Black slip-on leather sneakers", imageUrl: "/images/sim-2.png", price: 17000, category: "clothing", tags: "Clothing · Footwear", rating: 4, reviewCount: 8 },
  { slug: "grey-knit-running-shoes", name: "Grey knit running shoes", imageUrl: "/images/sim-3.png", price: 17000, category: "clothing", tags: "Clothing · Footwear", rating: 4, reviewCount: 10 },
  { slug: "sky-blue-court-sneakers", name: "Sky-blue court sneakers", imageUrl: "/images/sim-4.png", price: 17000, category: "clothing", tags: "Clothing · Footwear", rating: 4, reviewCount: 12 },
];

async function main() {
  const now = Date.now();
  const ids = new Map<string, string>();
  for (const [i, c] of categories.entries()) {
    const row = await prisma.category.upsert({ where: { slug: c.slug }, create: { ...c, sortOrder: i }, update: { ...c, sortOrder: i } });
    ids.set(c.slug, row.id);
  }

  for (const [i, p] of products.entries()) {
    const data = {
      name: p.name,
      imageUrl: p.imageUrl,
      price: p.price,
      oldPrice: p.kind === "flash" ? p.oldPrice : null,
      categoryId: ids.get(p.category)!,
      tags: p.tags,
      location: LAGOS,
      gallery: p.gallery ?? [],
      variations: p.variations ?? [],
      condition: p.condition ?? null,
      status: "ACTIVE" as const,
      flashSaleEndsAt: p.kind === "flash" ? new Date(now + 7 * DAY) : null,
      featuredScore: p.kind === "featured" ? 10 : 0,
    };
    // New items were listed in the last few days; everything else two months ago (so it isn't "New").
    const createdAt = new Date(p.kind === "new" ? now - (i - 2) * DAY : now - 60 * DAY - i * 3_600_000);
    const row = await prisma.product.upsert({ where: { slug: p.slug }, create: { slug: p.slug, ...data, createdAt }, update: { ...data, createdAt } });
    // Ratings come only from real reviews (never made-up numbers), and re-seeding never overwrites them.
    const agg = await prisma.review.aggregate({ where: { productId: row.id }, _avg: { rating: true }, _count: { _all: true } });
    await prisma.product.update({
      where: { id: row.id },
      data: { rating: Math.round((agg._avg.rating ?? 0) * 10) / 10, reviewCount: agg._count._all },
    });
  }
  // Home banner: only when there are none yet, so banners edited by admins are never overwritten.
  if ((await prisma.banner.count()) === 0)
    await prisma.banner.create({
      data: {
        eyebrow: "Happening Now",
        title: "Big Sale",
        highlight: "Up to 50%",
        subtitle: "More of what you love. Less than you expect.",
        ctaLabel: "Shop the sale",
        ctaHref: "/products",
        imageUrl: "/images/big-sale.png",
        backgroundColor: "#f8b91b",
      },
    });

  console.log(`Seeded ${categories.length} categories, ${products.length} products and the home banner.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
