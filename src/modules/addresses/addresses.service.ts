import { HttpStatus, Injectable } from "@nestjs/common";
import { AppException } from "../../common/exceptions/app.exception";
import { normalizeNigerianPhone } from "../../common/utils/phone";
import { PrismaService } from "../../prisma/prisma.service";
import { AddressDto, type CreateAddressDto, type UpdateAddressDto } from "./dto/address.dto";

export const MAX_ADDRESSES = 20;

const badPhone = () =>
  new AppException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", "Enter a valid Nigerian phone number", { fields: { phone: "Enter a valid Nigerian phone number" } });

/**
 * Saved delivery addresses. A user with any addresses always has exactly one default:
 * the first one added, the one they pick, or (after deleting the default) the most recently added.
 */
@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Default first, then newest. */
  async list(userId: string): Promise<AddressDto[]> {
    const rows = await this.prisma.address.findMany({ where: { userId }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] });
    return rows.map((a) => AddressDto.from(a));
  }

  async create(userId: string, dto: CreateAddressDto): Promise<AddressDto[]> {
    const phone = normalizeNigerianPhone(dto.phone);
    if (!phone) throw badPhone();
    const count = await this.prisma.address.count({ where: { userId } });
    if (count >= MAX_ADDRESSES)
      throw new AppException(HttpStatus.CONFLICT, "TOO_MANY_ADDRESSES", `You can save up to ${MAX_ADDRESSES} addresses. Delete one you don't use first.`);
    const isDefault = count === 0 || !!dto.isDefault;
    await this.prisma.$transaction([
      ...(isDefault ? [this.prisma.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } })] : []),
      this.prisma.address.create({ data: { userId, label: dto.label, name: dto.name, phone, address: dto.address, isDefault } }),
    ]);
    return this.list(userId);
  }

  async update(userId: string, id: string, dto: UpdateAddressDto): Promise<AddressDto[]> {
    const current = await this.own(userId, id);
    const phone = dto.phone !== undefined ? normalizeNigerianPhone(dto.phone) : current.phone;
    if (!phone) throw badPhone();
    if (dto.isDefault === false && current.isDefault)
      throw new AppException(HttpStatus.BAD_REQUEST, "DEFAULT_REQUIRED", "Pick another address as your default instead.");
    await this.prisma.$transaction([
      ...(dto.isDefault ? [this.prisma.address.updateMany({ where: { userId, isDefault: true, id: { not: id } }, data: { isDefault: false } })] : []),
      this.prisma.address.update({
        where: { id },
        data: {
          ...(dto.label !== undefined ? { label: dto.label } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          phone,
          ...(dto.isDefault ? { isDefault: true } : {}),
        },
      }),
    ]);
    return this.list(userId);
  }

  async remove(userId: string, id: string): Promise<AddressDto[]> {
    const current = await this.own(userId, id);
    await this.prisma.address.delete({ where: { id } });
    if (current.isDefault) {
      const next = await this.prisma.address.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
      if (next) await this.prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    return this.list(userId);
  }

  private async own(userId: string, id: string) {
    const a = await this.prisma.address.findFirst({ where: { id, userId } });
    if (!a) throw new AppException(HttpStatus.NOT_FOUND, "ADDRESS_NOT_FOUND", "We couldn't find that address.");
    return a;
  }
}
