import { HttpStatus, Injectable } from "@nestjs/common";
import { AppException } from "../../common/exceptions/app.exception";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { MyReviewDto, RatingSummaryDto, ReviewDto, ReviewPageDto, ReviewSort } from "./dto/review.dto";

const ORDER: Record<ReviewSort, Prisma.ReviewOrderByWithRelationInput[]> = {
  newest: [{ createdAt: "desc" }],
  highest: [{ rating: "desc" }, { createdAt: "desc" }],
  lowest: [{ rating: "asc" }, { createdAt: "desc" }],
};

type Row = Prisma.ReviewGetPayload<{ include: { user: { select: { firstName: true; lastName: true; avatarUrl: true } } } }>;

const toDto = (r: Row): ReviewDto => ({
  id: r.id,
  rating: r.rating,
  text: r.text,
  author: {
    name: `${r.user.firstName} ${r.user.lastName ? `${r.user.lastName[0]}.` : ""}`.trim(),
    ...(r.user.avatarUrl ? { avatar: r.user.avatarUrl } : {}),
  },
  createdAt: r.createdAt,
  edited: r.updatedAt.getTime() - r.createdAt.getTime() > 1000,
});

const author = { user: { select: { firstName: true, lastName: true, avatarUrl: true } } } as const;

/** Star ratings + comments. A product's rating and review count always reflect its real reviews. */
@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  private async product(slug: string) {
    const p = await this.prisma.product.findFirst({ where: { slug, status: { not: "DRAFT" } }, select: { id: true, sellerId: true } });
    if (!p) throw new AppException(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "This item isn't available any more.");
    return p;
  }

  async summary(productId: string): Promise<RatingSummaryDto> {
    const groups = await this.prisma.review.groupBy({ by: ["rating"], where: { productId }, _count: { _all: true } });
    const breakdown = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } as RatingSummaryDto["breakdown"];
    let count = 0;
    let sum = 0;
    for (const g of groups) {
      breakdown[String(g.rating) as keyof typeof breakdown] = g._count._all;
      count += g._count._all;
      sum += g.rating * g._count._all;
    }
    return { average: count ? Math.round((sum / count) * 10) / 10 : 0, count, breakdown };
  }

  async list(slug: string, sort: ReviewSort, page: number, limit: number): Promise<ReviewPageDto> {
    const { id } = await this.product(slug);
    const [rows, summary] = await Promise.all([
      this.prisma.review.findMany({ where: { productId: id }, include: author, orderBy: ORDER[sort], skip: (page - 1) * limit, take: limit }),
      this.summary(id),
    ]);
    return { items: rows.map(toDto), total: summary.count, page, limit, summary };
  }

  async mine(userId: string, slug: string): Promise<MyReviewDto> {
    const p = await this.product(slug);
    const r = await this.prisma.review.findUnique({ where: { productId_userId: { productId: p.id, userId } }, include: author });
    return { review: r ? toDto(r) : null, canReview: p.sellerId !== userId };
  }

  async save(userId: string, slug: string, rating: number, text = ""): Promise<ReviewDto> {
    const p = await this.product(slug);
    if (p.sellerId === userId) throw new AppException(HttpStatus.FORBIDDEN, "OWN_LISTING", "You can't review your own listing.");
    const r = await this.prisma.review.upsert({
      where: { productId_userId: { productId: p.id, userId } },
      create: { productId: p.id, userId, rating, text },
      update: { rating, text },
      include: author,
    });
    await this.recalculate(p.id);
    return toDto(r);
  }

  async remove(userId: string, slug: string): Promise<void> {
    const p = await this.product(slug);
    const { count } = await this.prisma.review.deleteMany({ where: { productId: p.id, userId } });
    if (!count) throw new AppException(HttpStatus.NOT_FOUND, "REVIEW_NOT_FOUND", "You haven't reviewed this item.");
    await this.recalculate(p.id);
  }

  /** Admin: remove any review (e.g. abusive). */
  async removeById(id: string): Promise<void> {
    const r = await this.prisma.review.delete({ where: { id } }).catch(() => null);
    if (!r) throw new AppException(HttpStatus.NOT_FOUND, "REVIEW_NOT_FOUND", "That review doesn't exist.");
    await this.recalculate(r.productId);
  }

  /** Copies the real average and count onto the product (shown on cards, sorted by "Top rated"). */
  private async recalculate(productId: string) {
    const s = await this.summary(productId);
    await this.prisma.product.update({ where: { id: productId }, data: { rating: s.average, reviewCount: s.count } });
  }
}
