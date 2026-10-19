import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiTooManyRequestsResponse } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Client, type ClientInfo } from "../../common/decorators/client-info.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { AdminOnly } from "../../common/admin/admin-areas";
import { AdminGuard } from "../../common/guards/admin.guard";
import { Idempotent } from "../../common/idempotency/idempotency.interceptor";
import { ContactService } from "./contact.service";
import { ContactMessageDto, ContactReceiptDto, CreateContactMessageDto, UpdateContactStatusDto } from "./dto/contact.dto";

@ApiTags("Contact")
@Controller({ version: "1" })
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  @Post("contact")
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Send a message from the Contact page (emailed to support; the sender gets a confirmation)" })
  @ApiOkResponse({ type: ContactReceiptDto })
  @ApiTooManyRequestsResponse({ description: "More than 5 messages in 10 minutes from one IP" })
  create(@Body() dto: CreateContactMessageDto, @Client() client: ClientInfo) {
    return this.contact.create(dto, client.ip);
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @AdminOnly("moderation")
  @Get("admin/contact-messages")
  @ApiOperation({ summary: "Admin: latest contact messages" })
  @ApiQuery({ name: "status", required: false, enum: ["NEW", "RESOLVED"] })
  @ApiOkResponse({ type: [ContactMessageDto] })
  list(@Query("status") status?: string) {
    return this.contact.list(status === "NEW" || status === "RESOLVED" ? status : undefined);
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @AdminOnly("moderation")
  @Patch("admin/contact-messages/:id")
  @ApiOperation({ summary: "Admin: mark a message resolved (or new again)" })
  @ApiOkResponse({ type: ContactMessageDto })
  setStatus(@Param("id") id: string, @Body() dto: UpdateContactStatusDto) {
    return this.contact.setStatus(id, dto.status);
  }
}
