import { HttpStatus, Injectable } from "@nestjs/common";
import { AppException } from "../../common/exceptions/app.exception";
import { PrismaService } from "../../prisma/prisma.service";
import type { BlockedUserDto, CreateReportDto, ReportCreatedDto } from "./dto/safety.dto";

const shortName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName ? `${u.lastName[0]}.` : ""}`.trim();

/** Reporting listings and people to the admins, and blocking people from messaging you. */
@Injectable()
export class SafetyService {
  constructor(private readonly prisma: PrismaService) {}

  async report(userId: string, dto: CreateReportDto): Promise<ReportCreatedDto> {
    let productId: string | null = null;
    let targetUserId: string | null = null;
    if (dto.type === "product") {
      const p = await this.prisma.product.findUnique({ where: { slug: dto.id }, select: { id: true, sellerId: true } });
      if (!p) throw new AppException(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "We couldn't find that listing.");
      if (p.sellerId === userId) throw new AppException(HttpStatus.BAD_REQUEST, "OWN_LISTING", "You can't report your own listing.");
      productId = p.id;
      targetUserId = p.sellerId;
    } else {
      if (dto.id === userId) throw new AppException(HttpStatus.BAD_REQUEST, "SELF_REPORT", "You can't report yourself.");
      const u = await this.prisma.user.findUnique({ where: { id: dto.id }, select: { id: true } });
      if (!u) throw new AppException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "We couldn't find that person.");
      targetUserId = u.id;
    }
    // One open report per person per target: reporting again just updates it.
    const existing = await this.prisma.report.findFirst({
      where: { reporterId: userId, targetType: dto.type, status: "OPEN", ...(productId ? { productId } : { productId: null, targetUserId }) },
      select: { id: true },
    });
    const r = existing
      ? await this.prisma.report.update({ where: { id: existing.id }, data: { reason: dto.reason, details: dto.details?.trim() ?? "" } })
      : await this.prisma.report.create({ data: { reporterId: userId, targetType: dto.type, productId, targetUserId, reason: dto.reason, details: dto.details?.trim() ?? "" } });
    return { id: r.id, status: r.status.toLowerCase() };
  }

  async blocks(userId: string): Promise<BlockedUserDto[]> {
    const rows = await this.prisma.block.findMany({
      where: { blockerId: userId },
      include: { blocked: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((b) => ({ id: b.blocked.id, name: shortName(b.blocked), ...(b.blocked.avatarUrl ? { avatar: b.blocked.avatarUrl } : {}), blockedAt: b.createdAt }));
  }

  async block(userId: string, otherId: string) {
    if (otherId === userId) throw new AppException(HttpStatus.BAD_REQUEST, "SELF_BLOCK", "You can't block yourself.");
    if (!(await this.prisma.user.findUnique({ where: { id: otherId }, select: { id: true } })))
      throw new AppException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "We couldn't find that person.");
    await this.prisma.block.upsert({ where: { blockerId_blockedId: { blockerId: userId, blockedId: otherId } }, create: { blockerId: userId, blockedId: otherId }, update: {} });
  }

  async unblock(userId: string, otherId: string) {
    await this.prisma.block.deleteMany({ where: { blockerId: userId, blockedId: otherId } });
  }
}
