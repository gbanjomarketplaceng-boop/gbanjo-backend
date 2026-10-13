import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { AppException } from "../../common/exceptions/app.exception";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import type { ContactReceiptDto, CreateContactMessageDto } from "./dto/contact.dto";

const RECEIPT = "We've got your message and will reply by email soon.";

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(dto: CreateContactMessageDto, ip?: string): Promise<ContactReceiptDto> {
    // Honeypot filled in: a bot. Answer as usual so it learns nothing, but keep nothing.
    if (dto.website) {
      this.logger.warn(`Dropped a contact message caught by the honeypot (ip ${ip ?? "?"})`);
      return { message: RECEIPT };
    }
    const saved = await this.prisma.contactMessage.create({
      data: { name: dto.name, email: dto.email, topic: dto.topic, orderRef: dto.orderRef || null, subject: dto.subject, message: dto.message, ipAddress: ip },
    });
    await this.notifications.contactMessage(saved);
    return { message: RECEIPT, reference: saved.id.slice(-8).toUpperCase() };
  }

  list(status?: "NEW" | "RESOLVED") {
    return this.prisma.contactMessage.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 200 });
  }

  async setStatus(id: string, status: "NEW" | "RESOLVED") {
    const found = await this.prisma.contactMessage.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new AppException(HttpStatus.NOT_FOUND, "MESSAGE_NOT_FOUND", "That message doesn't exist.");
    return this.prisma.contactMessage.update({ where: { id }, data: { status } });
  }
}
