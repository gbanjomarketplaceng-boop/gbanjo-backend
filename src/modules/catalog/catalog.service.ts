import { HttpStatus, Injectable } from "@nestjs/common";
import { AppException } from "../../common/exceptions/app.exception";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { BannersService } from "../banners/banners.service";
import { HOME_FLASH_SALE_LIMIT, HOME_JUST_FOR_YOU_LIMIT, HOME_NEW_ITEMS_LIMIT, NEW_ITEM_DAYS } from "./catalog.constants";
import { CategoryDto, PRODUCT_INCLUDE, type FlashSaleDto, type HomeDto, ProductDto, type ProductPageDto, type SuggestionsDto } from "./dto/catalog.dto";
import type { JustForYouQuery, ListProductsQuery, ProductSort } from "./dto/queries.dto";

type ProductRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

/** Lower-cased search words: "Olive  Sneakers" → ["olive", "sneakers"] (max 8). */
export const searchWords = (q?: string) =>
  (q ?? "")
    .toLowerCase()
    .split(/[\s,]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}'-]/gu, ""))
    .filter(Boolean)
    .slice(0, 8);

/** Every word must appear somewhere: name, tags, category name or description (any order, any case). */
const matchAllWords = (words: string[]): Prisma.ProductWhereInput[] =>
  words.map((w) => ({
    OR: [
      { name: { contains: w, mode: "insensitive" } },
      { tags: { contains: w, mode: "insensitive" } },
      { category: { name: { contains: w, mode: "insensitive" } } },
      { description: { contains: w, mode: "insensitive" } },
    ],
  }));

/** How well a product matches the search: whole phrase in the name beats words in the name, beats tags/category/description. */
function relevance(p: ProductRow, phrase: string, words: string[]) {
  const name = p.name.toLowerCase();
  const tags = p.tags.toLowerCase();
  const cat = p.category.name.toLowerCase();
  const desc = (p.description ?? "").toLowerCase();
  let score = name === phrase ? 100 : name.startsWith(phrase) ? 60 : name.includes(phrase) ? 40 : 0;
  for (const w of words) {
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(name)) score += 15;
    else if (name.includes(w)) score += 10;
    if (tags.includes(w)) score += 4;
    if (cat.includes(w)) score += 3;
    if (desc.includes(w)) score += 1;
  }
  return score + Number(p.rating) * 0.5 + Math.log1p(p.reviewCount) * 0.2;
}

/** Ranking by relevance needs every match scored, so search pages over at most this many matches. */
const MAX_RANKED = 500;

const withCategory = PRODUCT_INCLUDE;

const ORDER: Record<Exclude<ProductSort, "relevance">, Prisma.ProductOrderByWithRelationInput[]> = {
  newest: [{ createdAt: "desc" }],
  price_asc: [{ price: "asc" }, { createdAt: "desc" }],
  price_desc: [{ price: "desc" }, { createdAt: "desc" }],
  rating: [{ rating: "desc" }, { reviewCount: "desc" }],
  popular: [{ reviewCount: "desc" }, { rating: "desc" }],
};

/** Read-only storefront: categories, search, product pages and the home page rails. Only ACTIVE products are shown. */
@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly banners: BannersService,
  ) {}

  async categories(): Promise<CategoryDto[]> {
    const rows = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { products: { where: { status: "ACTIVE" } } } } },
    });
    return rows.map((c) => CategoryDto.from(c));
  }

  async list(query: ListProductsQuery): Promise<ProductPageDto> {
    const words = searchWords(query.q);
    const sort: ProductSort = query.sort ?? (words.length ? "relevance" : "newest");
    const where: Prisma.ProductWhereInput = {
      status: "ACTIVE",
      ...(query.category ? { category: { slug: query.category } } : {}),
      ...(words.length ? { AND: matchAllWords(words) } : {}),
      ...(query.minPrice !== undefined || query.maxPrice !== undefined
        ? { price: { ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}), ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}) } }
        : {}),
    };
    const now = new Date();
    const skip = (query.page - 1) * query.limit;

    if (sort === "relevance" && words.length) {
      const rows = await this.prisma.product.findMany({ where, include: withCategory, orderBy: { createdAt: "desc" }, take: MAX_RANKED });
      const phrase = words.join(" ");
      const ranked = rows.map((p) => ({ p, s: relevance(p, phrase, words) })).sort((a, b) => b.s - a.s);
      return { items: ranked.slice(skip, skip + query.limit).map(({ p }) => ProductDto.from(p, now)), total: rows.length, page: query.page, limit: query.limit };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({ where, include: withCategory, orderBy: ORDER[sort === "relevance" ? "newest" : sort], skip, take: query.limit }),
    ]);
    return { items: rows.map((p) => ProductDto.from(p, now)), total, page: query.page, limit: query.limit };
  }

  /** Search-as-you-type: best product matches plus matching categories. */
  async suggestions(q: string, limit = 6): Promise<SuggestionsDto> {
    const words = searchWords(q);
    if (!words.length) return { query: q, products: [], categories: [], total: 0 };
    const [page, categories] = await Promise.all([
      this.list({ q, sort: "relevance", page: 1, limit }),
      this.prisma.category.findMany({
        where: { OR: words.map((w) => ({ name: { contains: w, mode: "insensitive" as const } })) },
        include: { _count: { select: { products: { where: { status: "ACTIVE" } } } } },
        orderBy: { sortOrder: "asc" },
        take: 3,
      }),
    ]);
    return { query: q, products: page.items, categories: categories.map((c) => CategoryDto.from(c)), total: page.total };
  }

  async product(slug: string): Promise<ProductDto> {
    const p = await this.prisma.product.findFirst({ where: { slug, status: "ACTIVE" }, include: withCategory });
    if (!p) throw new AppException(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "This item isn't available any more.");
    return ProductDto.from(p);
  }

  /** Same category first (best rated), topped up from other categories if there aren't enough. */
  async similar(slug: string, limit = 4): Promise<ProductDto[]> {
    const p = await this.prisma.product.findFirst({ where: { slug, status: "ACTIVE" }, select: { id: true, categoryId: true } });
    if (!p) throw new AppException(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "This item isn't available any more.");
    const same = await this.prisma.product.findMany({
      where: { status: "ACTIVE", categoryId: p.categoryId, id: { not: p.id } },
      include: withCategory,
      orderBy: [{ rating: "desc" }, { reviewCount: "desc" }],
      take: limit,
    });
    const more =
      same.length < limit
        ? await this.prisma.product.findMany({
            where: { status: "ACTIVE", id: { notIn: [p.id, ...same.map((s) => s.id)] } },
            include: withCategory,
            orderBy: [{ rating: "desc" }, { reviewCount: "desc" }],
            take: limit - same.length,
          })
        : [];
    return [...same, ...more].map((x) => ProductDto.from(x));
  }

  /** Discounted items whose flash sale hasn't ended, ending soonest first. */
  async flashSale(limit = 8): Promise<FlashSaleDto> {
    const now = new Date();
    const rows = await this.prisma.product.findMany({
      where: { status: "ACTIVE", oldPrice: { not: null }, flashSaleEndsAt: { gt: now } },
      include: withCategory,
      orderBy: [{ flashSaleEndsAt: "asc" }, { createdAt: "desc" }],
      take: limit,
    });
    return { endsAt: rows[0]?.flashSaleEndsAt ?? null, items: rows.map((p) => ProductDto.from(p, now)) };
  }

  /** Latest listings from the last NEW_ITEM_DAYS days. */
  async newItems(limit = 8, excludeIds: string[] = []): Promise<ProductDto[]> {
    const now = new Date();
    const rows = await this.prisma.product.findMany({
      where: { status: "ACTIVE", createdAt: { gte: new Date(now.getTime() - NEW_ITEM_DAYS * 86_400_000) }, slug: { notIn: excludeIds } },
      include: withCategory,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((p) => ProductDto.from(p, now));
  }

  /**
   * Recommendations: editorial boost, then rating and popularity, with the shopper's preferred
   * categories (from their wishlist/cart) ranked first.
   */
  async justForYou(query: JustForYouQuery): Promise<ProductDto[]> {
    const limit = query.limit ?? 8;
    const prefer = new Set(query.prefer ?? []);
    const rows = await this.prisma.product.findMany({
      where: {
        status: "ACTIVE",
        ...(query.category ? { category: { slug: query.category } } : {}),
        ...(query.exclude?.length ? { slug: { notIn: query.exclude } } : {}),
      },
      include: withCategory,
      orderBy: [{ featuredScore: "desc" }, { rating: "desc" }],
      take: 200,
    });
    const score = (p: (typeof rows)[number]) =>
      p.featuredScore * 10 + Number(p.rating) * 2 + Math.log1p(p.reviewCount) + (prefer.has(p.category.slug) ? 15 : 0);
    const now = new Date();
    return rows
      .map((p) => ({ p, s: score(p) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map(({ p }) => ProductDto.from(p, now));
  }

  /** Everything the home page needs in one call; each rail avoids repeating items from the ones above it. */
  async home(prefer?: string[]): Promise<HomeDto> {
    const [banners, categories, flashSale] = await Promise.all([this.banners.live(), this.categories(), this.flashSale(HOME_FLASH_SALE_LIMIT)]);
    const newItems = await this.newItems(HOME_NEW_ITEMS_LIMIT, flashSale.items.map((p) => p.id));
    const justForYou = await this.justForYou({
      limit: HOME_JUST_FOR_YOU_LIMIT,
      prefer,
      exclude: [...flashSale.items, ...newItems].map((p) => p.id),
    });
    return { banners, categories, flashSale, newItems, justForYou };
  }
}
