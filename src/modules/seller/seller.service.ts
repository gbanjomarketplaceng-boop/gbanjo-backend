import { randomBytes } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import { AppException } from "../../common/exceptions/app.exception";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { InboxService } from "../inbox/inbox.service";
import { UploadsService } from "../uploads/uploads.service";
import { ListingDto, type ReviewVerificationDto, type SaveListingDto, type SubmitVerificationDto, SellerVerificationDto } from "./dto/seller.dto";
import { MAX_LISTINGS } from "./seller.constants";

const STATUS = { draft: "DRAFT", active: "ACTIVE", sold: "SOLD" } as const;

/** "iPhone 13 Pro!" → "iphone-13-pro-k3x9qa" (random tail keeps slugs unique). */
export const listingSlug = (title: string) => {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${base || "listing"}-${randomBytes(4).toString("hex").slice(0, 6)}`;
};

const invalid = (fields: Record<string, string>) =>
  new AppException(HttpStatus.BAD_REQUEST, "LISTING_INCOMPLETE", Object.values(fields)[0], { fields });

/**
 * Selling: identity verification and the seller's own listings. A listing is a Product with a seller;
 * active ones show in the storefront, search and the category pages straight away.
 */
@Injectable()
export class SellerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly inbox: InboxService,
  ) {}

  // ---------- Verification ----------

  async verification(userId: string): Promise<SellerVerificationDto> {
    return SellerVerificationDto.from(await this.prisma.sellerVerification.findUnique({ where: { userId } }));
  }

  async submitVerification(userId: string, dto: SubmitVerificationDto): Promise<SellerVerificationDto> {
    const current = await this.prisma.sellerVerification.findUnique({ where: { userId } });
    if (current?.status === "VERIFIED") throw new AppException(HttpStatus.CONFLICT, "ALREADY_VERIFIED", "Your seller account is already verified.");
    const doc = dto.documentPublicId?.trim();
    if (this.uploads.configured && !doc) throw invalid({ documentPublicId: "Upload a photo of the front of your ID." });
    if (doc && !this.uploads.ownsPublicId("id_document", userId, doc))
      throw new AppException(HttpStatus.FORBIDDEN, "NOT_YOUR_UPLOAD", "That photo doesn't belong to your account.");
    const data = { idType: dto.idType, documentPublicId: doc || null, status: "PENDING" as const, note: null, reviewedAt: null };
    const v = await this.prisma.sellerVerification.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    return SellerVerificationDto.from(v);
  }

  async listVerifications(status?: "PENDING" | "VERIFIED" | "REJECTED") {
    const rows = await this.prisma.sellerVerification.findMany({
      where: status ? { status } : {},
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
      orderBy: { updatedAt: "asc" },
      take: 200,
    });
    return rows.map((v) => ({
      id: v.id,
      user: v.user,
      idType: v.idType,
      status: v.status,
      note: v.note,
      submittedAt: v.updatedAt,
      reviewedAt: v.reviewedAt,
      document: v.documentPublicId ? (this.uploads.privateUrl(v.documentPublicId) ?? null) : null,
    }));
  }

  async reviewVerification(id: string, dto: ReviewVerificationDto) {
    const v = await this.prisma.sellerVerification
      .update({ where: { id }, data: { status: dto.status, note: dto.status === "REJECTED" ? (dto.note ?? null) : null, reviewedAt: new Date() } })
      .catch(() => null);
    if (!v) throw new AppException(HttpStatus.NOT_FOUND, "NOT_FOUND", "That verification doesn't exist.");
    await this.inbox.notify(
      v.userId,
      v.status === "VERIFIED"
        ? { type: "seller", title: "You're verified to sell", body: "Your ID was approved. Your listings now show the ID Verified badge.", href: "/sell" }
        : { type: "seller", title: "We couldn't verify your ID", body: v.note ? `Reason: ${v.note}. Please submit it again.` : "Please submit your ID again.", href: "/sell/verify" },
    );
    return SellerVerificationDto.from(v);
  }

  /** Sellers can list once they've sent their ID (while it's being reviewed too), but not after a rejection. */
  private async assertCanSell(userId: string) {
    const v = await this.prisma.sellerVerification.findUnique({ where: { userId }, select: { status: true } });
    if (!v) throw new AppException(HttpStatus.FORBIDDEN, "VERIFICATION_REQUIRED", "Verify your identity before you start selling.");
    if (v.status === "REJECTED")
      throw new AppException(HttpStatus.FORBIDDEN, "VERIFICATION_REJECTED", "Your ID couldn't be verified. Please submit it again to keep selling.");
  }

  // ---------- Listings ----------

  async listings(userId: string): Promise<ListingDto[]> {
    const rows = await this.prisma.product.findMany({ where: { sellerId: userId }, include: { category: true }, orderBy: { updatedAt: "desc" } });
    return rows.map((p) => ListingDto.from(p));
  }

  async listing(userId: string, id: string): Promise<ListingDto> {
    return ListingDto.from(await this.own(userId, id));
  }

  private async own(userId: string, id: string) {
    const p = await this.prisma.product.findFirst({ where: { id, sellerId: userId }, include: { category: true } });
    if (!p) throw new AppException(HttpStatus.NOT_FOUND, "LISTING_NOT_FOUND", "We couldn't find that listing.");
    return p;
  }

  async create(userId: string, dto: SaveListingDto): Promise<ListingDto> {
    await this.assertCanSell(userId);
    if ((await this.prisma.product.count({ where: { sellerId: userId } })) >= MAX_LISTINGS)
      throw new AppException(HttpStatus.CONFLICT, "TOO_MANY_LISTINGS", `You can have up to ${MAX_LISTINGS} listings. Delete some old ones first.`);
    const status = dto.status === "active" ? "ACTIVE" : "DRAFT";
    if (dto.status === "sold") throw invalid({ status: "Publish the listing before marking it as sold." });
    const fields = await this.resolve(userId, dto, status);
    const p = await this.prisma.product.create({
      data: { ...fields, slug: listingSlug(fields.name), status, sellerId: userId, rating: 0, reviewCount: 0 } as Prisma.ProductUncheckedCreateInput,
      include: { category: true },
    });
    return ListingDto.from(p);
  }

  async update(userId: string, id: string, dto: SaveListingDto): Promise<ListingDto> {
    const current = await this.own(userId, id);
    const status = dto.status ? STATUS[dto.status] : current.status;
    if (current.removedByAdmin && status === "ACTIVE")
      throw new AppException(HttpStatus.FORBIDDEN, "LISTING_REMOVED", "This listing was taken down by Gbanjo and can't be published again. Contact support if you think this is a mistake.");
    if (status !== current.status || status === "ACTIVE") await this.assertCanSell(userId);
    if (status === "SOLD" && current.status === "DRAFT") throw invalid({ status: "Publish the listing before marking it as sold." });
    const merged: SaveListingDto = {
      title: dto.title ?? current.name,
      category: dto.category ?? current.category.slug,
      condition: dto.condition ?? current.condition ?? undefined,
      description: dto.description ?? current.description ?? undefined,
      brand: dto.brand ?? current.brand ?? undefined,
      price: dto.price ?? Number(current.price),
      negotiable: dto.negotiable ?? current.negotiable,
      location: dto.location ?? current.location,
      delivery: dto.delivery ?? current.delivery ?? undefined,
      photos: dto.photos ?? [current.imageUrl, ...current.gallery].filter(Boolean),
    };
    const fields = await this.resolve(userId, merged, status === "DRAFT" ? "DRAFT" : "ACTIVE");
    const firstPublish = current.status === "DRAFT" && status === "ACTIVE";
    const p = await this.prisma.product.update({
      where: { id },
      data: {
        ...fields,
        status,
        // Drafts get a fresh slug when renamed; once live the link stays the same.
        ...(current.status === "DRAFT" && fields.name !== current.name ? { slug: listingSlug(fields.name) } : {}),
        // Counts as new from the moment it goes live.
        ...(firstPublish ? { createdAt: new Date() } : {}),
      },
      include: { category: true },
    });
    // Photos taken out of the listing are deleted from Cloudinary.
    const kept = new Set([p.imageUrl, ...p.gallery]);
    for (const url of [current.imageUrl, ...current.gallery]) if (url && !kept.has(url)) void this.uploads.removeByUrl("listing_photo", userId, url);
    return ListingDto.from(p);
  }

  async remove(userId: string, id: string): Promise<void> {
    const p = await this.own(userId, id);
    await this.prisma.product.delete({ where: { id } });
    for (const url of [p.imageUrl, ...p.gallery]) if (url) void this.uploads.removeByUrl("listing_photo", userId, url);
  }

  /** Validates a listing and turns it into product columns. Drafts only need a category. */
  private async resolve(userId: string, dto: SaveListingDto, status: "DRAFT" | "ACTIVE") {
    const errors: Record<string, string> = {};
    const live = status === "ACTIVE";
    const title = dto.title?.trim() ?? "";
    const photos = [...new Set(dto.photos ?? [])];
    if (!dto.category) errors.category = "Select a category";
    if (live && title.length < 3) errors.title = "Enter a product name (at least 3 characters)";
    if (live && !(dto.price && dto.price > 0)) errors.price = "Enter a valid price";
    if (live && !photos.length) errors.photos = "Add at least one photo";
    if (live && !dto.location?.trim()) errors.location = "Add the item's location";
    const bad = photos.find((u) => !this.uploads.isOwnedUrl("listing_photo", userId, u));
    if (bad) errors.photos = bad.startsWith("data:") ? "Photo uploads aren't set up on the server yet, so this listing can't be saved." : "Use photos uploaded from this account.";
    const category = dto.category ? await this.prisma.category.findUnique({ where: { slug: dto.category } }) : null;
    if (dto.category && !category) errors.category = "Select a category from the list";
    if (Object.keys(errors).length) throw invalid(errors);

    const condition = dto.condition ?? "Like New";
    return {
      name: title,
      description: dto.description?.trim() || null,
      price: dto.price ?? 0,
      categoryId: category!.id,
      tags: `${category!.name} · ${condition}`,
      location: dto.location?.trim() || "",
      imageUrl: photos[0] ?? "",
      gallery: photos.slice(1),
      variations: [] as string[],
      condition,
      brand: dto.brand?.trim() || null,
      negotiable: dto.negotiable ?? false,
      delivery: dto.delivery ?? "buyer-pays",
    };
  }
}
