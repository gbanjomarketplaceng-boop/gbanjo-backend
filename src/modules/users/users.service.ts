import { HttpStatus, Injectable } from "@nestjs/common";
import * as argon2 from "argon2";
import { AppException } from "../../common/exceptions/app.exception";
import { normalizeNigerianPhone } from "../../common/utils/phone";
import { PrismaService } from "../../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { CompleteProfileDto } from "./dto/complete-profile.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  }

  findByPhone(phone: string) {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  async getOrThrow(id: string) {
    const user = await this.findById(id);
    if (!user) throw new AppException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "Account not found.");
    return user;
  }

  /**
   * Adds the name and phone number a Google/Apple sign-up didn't provide. The phone isn't SMS-verified here
   * (the provider already verified the email); a number that's already confirmed on another account is refused.
   */
  async completeProfile(id: string, dto: CompleteProfileDto) {
    const current = await this.getOrThrow(id);
    const phone = normalizeNigerianPhone(dto.phone);
    if (!phone)
      throw new AppException(HttpStatus.BAD_REQUEST, "INVALID_PHONE", "Enter a valid Nigerian phone number", { fields: { phone: "Enter a valid Nigerian phone number" } });
    if (current.phoneVerifiedAt && phone !== current.phone)
      throw new AppException(HttpStatus.CONFLICT, "PHONE_LOCKED", "Your phone number is already verified and can't be changed here.", {
        fields: { phone: "Your phone number is already verified and can't be changed here." },
      });

    const holder = await this.findByPhone(phone);
    if (holder && holder.id !== id) {
      if (holder.phoneVerifiedAt)
        throw new AppException(HttpStatus.CONFLICT, "PHONE_TAKEN", "Another account already uses this phone number.", {
          fields: { phone: "Another account already uses this phone number." },
        });
      // An unfinished sign-up is only holding the number: release it.
      await this.prisma.user.update({ where: { id: holder.id }, data: { phone: null } });
    }

    return this.prisma.user.update({
      where: { id },
      data: { firstName: dto.firstName, lastName: dto.lastName, phone, ...(phone !== current.phone ? { phoneVerifiedAt: null } : {}) },
    });
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    const current = await this.getOrThrow(id);
    // A new avatar must be one of this user's own Cloudinary uploads (POST /uploads/signature with purpose=avatar).
    if (dto.avatarUrl && dto.avatarUrl !== current.avatarUrl && !this.uploads.isOwnedUrl("avatar", id, dto.avatarUrl))
      throw new AppException(HttpStatus.BAD_REQUEST, "INVALID_AVATAR", "Upload your photo first, then save it.", { fields: { avatarUrl: "Upload your photo first, then save it." } });
    const emailChanged = dto.email !== undefined && dto.email !== current.email;
    if (emailChanged) {
      const taken = await this.findByEmail(dto.email!);
      if (taken && taken.id !== id) throw new AppException(HttpStatus.CONFLICT, "EMAIL_TAKEN", "An account with this email already exists.");
    }
    return this.prisma.user.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        avatarUrl: dto.avatarUrl,
        ...(emailChanged ? { email: dto.email, emailVerifiedAt: null } : {}),
      },
    });
  }

  /**
   * Deletes the account: personal details are wiped and sign-in stops working, while orders other people are
   * part of keep a "Deleted user". Refused while orders are still in progress or money is left in the wallet.
   */
  async deleteAccount(id: string, dto: { password?: string; confirm?: string }) {
    const user = await this.getOrThrow(id);
    if (user.passwordHash) {
      if (!dto.password || !(await argon2.verify(user.passwordHash, dto.password).catch(() => false)))
        throw new AppException(HttpStatus.BAD_REQUEST, "WRONG_PASSWORD", "That password isn't right.", { fields: { password: "That password isn't right." } });
    } else if (dto.confirm?.trim().toUpperCase() !== "DELETE") {
      throw new AppException(HttpStatus.BAD_REQUEST, "CONFIRM_REQUIRED", 'Type DELETE to confirm.', { fields: { confirm: 'Type DELETE to confirm.' } });
    }

    const open = await this.prisma.order.count({ where: { status: "ONGOING", OR: [{ buyerId: id }, { sellerId: id }] } });
    if (open)
      throw new AppException(HttpStatus.CONFLICT, "HAS_OPEN_ORDERS", `You have ${open} order${open === 1 ? "" : "s"} still in progress. Finish or cancel ${open === 1 ? "it" : "them"} first.`);
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: id }, select: { id: true, balance: true } });
    const held = wallet ? await this.prisma.walletTransaction.count({ where: { walletId: wallet.id, status: "PENDING" } }) : 0;
    if ((wallet && Number(wallet.balance) > 0) || held)
      throw new AppException(HttpStatus.CONFLICT, "WALLET_NOT_EMPTY", "There's still money in your wallet. Withdraw it to your bank before deleting your account.");
    if (await this.prisma.withdrawal.count({ where: { userId: id, status: { in: ["PENDING", "PROCESSING"] } } }))
      throw new AppException(HttpStatus.CONFLICT, "WITHDRAWAL_IN_PROGRESS", "Wait for your withdrawal to finish, then try again.");

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now, revokedReason: "account_deleted" } }),
      this.prisma.oAuthAccount.deleteMany({ where: { userId: id } }),
      this.prisma.pushToken.deleteMany({ where: { userId: id } }),
      this.prisma.address.deleteMany({ where: { userId: id } }),
      this.prisma.cartItem.deleteMany({ where: { userId: id } }),
      this.prisma.wishlistItem.deleteMany({ where: { userId: id } }),
      this.prisma.notification.deleteMany({ where: { userId: id } }),
      this.prisma.bankAccount.deleteMany({ where: { userId: id } }),
      this.prisma.sellerVerification.deleteMany({ where: { userId: id } }),
      // Listings come down (kept as drafts so past orders still link to them).
      this.prisma.product.updateMany({ where: { sellerId: id, status: "ACTIVE" }, data: { status: "DRAFT" } }),
      this.prisma.user.update({
        where: { id },
        data: {
          firstName: "Deleted",
          lastName: "user",
          email: `deleted-${id}@deleted.gbanjo.invalid`,
          phone: null,
          passwordHash: null,
          avatarUrl: null,
          phoneVerifiedAt: null,
          emailVerifiedAt: null,
          status: "DELETED",
          deletedAt: now,
        },
      }),
    ]);
  }
}
