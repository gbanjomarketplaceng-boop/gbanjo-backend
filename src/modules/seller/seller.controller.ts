import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { AdminGuard } from "../../common/guards/admin.guard";
import type { AuthUser } from "../auth/types/auth-user";
import { AdminVerificationDto, ListingDto, ReviewVerificationDto, SaveListingDto, SubmitVerificationDto, VerificationDto } from "./dto/seller.dto";
import { SellerService } from "./seller.service";

@ApiTags("Selling")
@ApiBearerAuth()
@Controller({ version: "1" })
export class SellerController {
  constructor(private readonly seller: SellerService) {}

  @Get("seller/verification")
  @ApiOperation({ summary: "My seller verification status (none | pending | verified | rejected)" })
  @ApiOkResponse({ type: VerificationDto })
  verification(@CurrentUser() user: AuthUser) {
    return this.seller.verification(user.id);
  }

  @Post("seller/verification")
  @ApiOperation({ summary: "Send my ID for review (upload it first with purpose id_document). Selling unlocks right away." })
  @ApiCreatedResponse({ type: VerificationDto })
  submit(@CurrentUser() user: AuthUser, @Body() dto: SubmitVerificationDto) {
    return this.seller.submitVerification(user.id, dto);
  }

  @Get("seller/listings")
  @ApiOperation({ summary: "My listings (drafts, active and sold), most recently changed first" })
  @ApiOkResponse({ type: [ListingDto] })
  listings(@CurrentUser() user: AuthUser) {
    return this.seller.listings(user.id);
  }

  @Get("seller/listings/:id")
  @ApiOperation({ summary: "One of my listings" })
  @ApiOkResponse({ type: ListingDto })
  listing(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.seller.listing(user.id, id);
  }

  @Post("seller/listings")
  @ApiOperation({ summary: "Create a listing: status draft (default) or active (publish now)" })
  @ApiCreatedResponse({ type: ListingDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: SaveListingDto) {
    return this.seller.create(user.id, dto);
  }

  @Patch("seller/listings/:id")
  @ApiOperation({ summary: "Edit, publish (status active), mark sold or move back to drafts" })
  @ApiOkResponse({ type: ListingDto })
  update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: SaveListingDto) {
    return this.seller.update(user.id, id, dto);
  }

  @Delete("seller/listings/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a listing (and its photos)" })
  @ApiNoContentResponse()
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.seller.remove(user.id, id);
  }

  @UseGuards(AdminGuard)
  @Get("admin/seller-verifications")
  @ApiOperation({ summary: "Admin: ID checks to review (with a short-lived link to the ID photo)" })
  @ApiQuery({ name: "status", required: false, enum: ["PENDING", "VERIFIED", "REJECTED"] })
  @ApiOkResponse({ type: [AdminVerificationDto] })
  listVerifications(@Query("status") status?: string) {
    return this.seller.listVerifications(status === "PENDING" || status === "VERIFIED" || status === "REJECTED" ? status : undefined);
  }

  @UseGuards(AdminGuard)
  @Patch("admin/seller-verifications/:id")
  @ApiOperation({ summary: "Admin: approve or reject a seller's ID" })
  @ApiOkResponse({ type: VerificationDto })
  review(@Param("id") id: string, @Body() dto: ReviewVerificationDto) {
    return this.seller.reviewVerification(id, dto);
  }
}
