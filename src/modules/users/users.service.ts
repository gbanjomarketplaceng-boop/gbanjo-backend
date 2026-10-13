import { HttpStatus, Injectable } from "@nestjs/common";
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
}
