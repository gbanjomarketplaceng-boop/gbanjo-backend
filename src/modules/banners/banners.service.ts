import { HttpStatus, Injectable } from "@nestjs/common";
import { AppException } from "../../common/exceptions/app.exception";
import { PrismaService } from "../../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { AdminBannerDto, BannerDto, type CreateBannerDto, type UpdateBannerDto } from "./dto/banner.dto";

@Injectable()
export class BannersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  /** Live slides for the home page: active and inside their schedule, in order. */
  async live(): Promise<BannerDto[]> {
    const now = new Date();
    const rows = await this.prisma.banner.findMany({
      where: { isActive: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((b) => BannerDto.from(b));
  }

  async all(): Promise<AdminBannerDto[]> {
    const rows = await this.prisma.banner.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    const now = new Date();
    return rows.map((b) => AdminBannerDto.fromAdmin(b, now));
  }

  async create(dto: CreateBannerDto): Promise<AdminBannerDto> {
    this.check(dto);
    const row = await this.prisma.banner.create({ data: dto });
    return AdminBannerDto.fromAdmin(row);
  }

  async update(id: string, dto: UpdateBannerDto): Promise<AdminBannerDto> {
    const current = await this.getOrThrow(id);
    this.check({ ...current, ...dto }, dto.imageUrl !== undefined && dto.imageUrl !== current.imageUrl);
    const row = await this.prisma.banner.update({ where: { id }, data: dto });
    return AdminBannerDto.fromAdmin(row);
  }

  async remove(id: string): Promise<void> {
    await this.getOrThrow(id);
    await this.prisma.banner.delete({ where: { id } });
  }

  private async getOrThrow(id: string) {
    const b = await this.prisma.banner.findUnique({ where: { id } });
    if (!b) throw new AppException(HttpStatus.NOT_FOUND, "BANNER_NOT_FOUND", "That banner doesn't exist.");
    return b;
  }

  /** New images must come from the Cloudinary banners folder (or be a built-in /images/… file). */
  private check(b: { imageUrl?: string; startsAt?: Date | null; endsAt?: Date | null }, imageChanged = true) {
    if (imageChanged && b.imageUrl && !b.imageUrl.startsWith("/") && !this.uploads.isBannerUrl(b.imageUrl))
      throw new AppException(HttpStatus.BAD_REQUEST, "INVALID_IMAGE", "Upload the banner image first.", { fields: { imageUrl: "Upload the banner image first." } });
    if (b.startsAt && b.endsAt && b.endsAt <= b.startsAt)
      throw new AppException(HttpStatus.BAD_REQUEST, "INVALID_SCHEDULE", "The end date must be after the start date.", { fields: { endsAt: "The end date must be after the start date." } });
  }
}
