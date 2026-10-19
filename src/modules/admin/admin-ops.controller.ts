import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { AdminOnly } from "../../common/admin/admin-areas";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { AdminGuard } from "../../common/guards/admin.guard";
import { Idempotent } from "../../common/idempotency/idempotency.interceptor";
import type { AuthUser } from "../auth/types/auth-user";
import { AdminOpsService } from "./admin-ops.service";
import {
  AddAdminDto,
  AdminLedgerQuery,
  AdminListingsQuery,
  AdminPaymentsQuery,
  BroadcastDto,
  CreateListingDto,
  CreateUserDto,
  DashboardQuery,
  DateRangeQuery,
  ExportQuery,
  PageQuery,
  SaveCategoryDto,
  SaveVoucherDto,
  UpdateAdminDto,
  UpdateListingDto,
  UpdateUserDto,
  UpdateVoucherDto,
  WalletAdjustmentDto,
} from "./dto/admin-ops.dto";

/** The signed-in admin (AdminGuard adds their admin role). */
type AdminUser = AuthUser & { adminRole?: string | null };

/** The back office: dashboard, money, catalog, customers, team, activity and announcements. */
@ApiTags("Admin")
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller({ path: "admin", version: "1" })
export class AdminOpsController {
  constructor(private readonly ops: AdminOpsService) {}

  @Get("me")
  @ApiOperation({ summary: "Admin: my admin role and which parts of the panel I can use" })
  me(@CurrentUser() me: AuthUser) {
    return this.ops.me(me.id);
  }

  @Get("dashboard")
  @AdminOnly("dashboard")
  @ApiOperation({ summary: "Admin: sales, revenue, growth and what needs attention" })
  dashboard(@Query() q: DashboardQuery) {
    return this.ops.dashboard(q.days ?? 30);
  }

  // ----- Finance -----

  @Get("finance/summary")
  @AdminOnly("finance")
  @ApiOperation({ summary: "Finance: sales, revenue, refunds and wallet money for a date range" })
  finance(@Query() q: DateRangeQuery) {
    return this.ops.financeSummary(q.from, q.to);
  }

  @Get("payments")
  @AdminOnly("finance")
  @ApiOperation({ summary: "Finance: every payment (card, bank transfer, USSD, wallet)" })
  payments(@Query() q: AdminPaymentsQuery) {
    return this.ops.payments(q);
  }

  @Get("ledger")
  @AdminOnly("finance")
  @ApiOperation({ summary: "Finance: every wallet movement" })
  ledger(@Query() q: AdminLedgerQuery) {
    return this.ops.ledger(q);
  }

  @Get("exports/:kind")
  @AdminOnly("finance")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Cache-Control", "no-store")
  @ApiProduces("text/csv")
  @ApiOperation({ summary: "Finance: download orders, payments, ledger, withdrawals or users as CSV" })
  async export(@Param("kind") kind: string, @Query() q: ExportQuery, @Res({ passthrough: true }) res: Response) {
    const { filename, csv } = await this.ops.export(kind, q.from, q.to);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return csv;
  }

  // ----- People -----

  @Get("users/:id")
  @AdminOnly("users", "finance")
  @ApiOperation({ summary: "Admin: everything about one person (orders, sales, wallet, listings, withdrawals)" })
  user(@Param("id") id: string) {
    return this.ops.userDetail(id);
  }

  @Post("users")
  @AdminOnly("users")
  @Idempotent()
  @ApiOperation({ summary: "Admin: create an account (super admins can also create admin accounts)" })
  createUser(@CurrentUser() me: AdminUser, @Body() dto: CreateUserDto) {
    return this.ops.createUser(me, dto);
  }

  @Patch("users/:id/details")
  @AdminOnly("users")
  @ApiOperation({ summary: "Admin: edit someone's name, email, phone or set a new password" })
  updateUser(@CurrentUser() me: AdminUser, @Param("id") id: string, @Body() dto: UpdateUserDto) {
    return this.ops.updateUser(me, id, dto);
  }

  @Delete("users/:id")
  @AdminOnly("users")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Admin: delete someone's account (refused while their orders or money are in progress)" })
  async deleteUser(@CurrentUser() me: AdminUser, @Param("id") id: string) {
    await this.ops.deleteUser(me, id);
  }

  @Post("users/:id/wallet-adjustments")
  @AdminOnly("finance")
  @Idempotent()
  @ApiOperation({ summary: "Finance: add money to (or take from) someone's wallet, with a reason" })
  adjust(@CurrentUser() me: AuthUser, @Param("id") id: string, @Body() dto: WalletAdjustmentDto) {
    return this.ops.adjustWallet(me.id, id, dto.amount, dto.reason);
  }

  // ----- Catalog -----

  @Get("listings")
  @AdminOnly("catalog", "moderation")
  @ApiOperation({ summary: "Catalog: all listings (search, filter by status/category)" })
  listings(@Query() q: AdminListingsQuery) {
    return this.ops.listings(q);
  }

  @Get("listings/:id")
  @AdminOnly("catalog", "moderation")
  @ApiOperation({ summary: "Catalog: one listing with every editable field" })
  listing(@Param("id") id: string) {
    return this.ops.listingDetail(id);
  }

  @Post("listings")
  @AdminOnly("catalog")
  @Idempotent()
  @ApiOperation({ summary: "Catalog: create a listing (Gbanjo's own, or for a seller by email)" })
  createListing(@Body() dto: CreateListingDto) {
    return this.ops.createListing(dto);
  }

  @Delete("listings/:id")
  @AdminOnly("catalog")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Catalog: delete a listing for good" })
  async deleteListing(@Param("id") id: string) {
    await this.ops.deleteListing(id);
  }

  @Patch("listings/:id")
  @AdminOnly("catalog")
  @ApiOperation({ summary: "Catalog: edit a listing (any field), feature it or put it in the flash sale" })
  updateListing(@Param("id") id: string, @Body() dto: UpdateListingDto) {
    return this.ops.updateListing(id, dto);
  }

  @Get("categories")
  @AdminOnly("catalog")
  @ApiOperation({ summary: "Catalog: categories with listing counts" })
  categories() {
    return this.ops.categories();
  }

  @Post("categories")
  @AdminOnly("catalog")
  @ApiOperation({ summary: "Catalog: add a category" })
  createCategory(@Body() dto: SaveCategoryDto) {
    return this.ops.createCategory(dto);
  }

  @Patch("categories/:id")
  @AdminOnly("catalog")
  @ApiOperation({ summary: "Catalog: rename a category, change its picture or order" })
  updateCategory(@Param("id") id: string, @Body() dto: SaveCategoryDto) {
    return this.ops.updateCategory(id, dto);
  }

  @Delete("categories/:id")
  @AdminOnly("catalog")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Catalog: delete an empty category" })
  deleteCategory(@Param("id") id: string) {
    return this.ops.deleteCategory(id);
  }

  @Get("vouchers")
  @AdminOnly("catalog", "finance")
  @ApiOperation({ summary: "Promotions: voucher codes with usage and discount given" })
  vouchers() {
    return this.ops.vouchers();
  }

  @Post("vouchers")
  @AdminOnly("catalog")
  @ApiOperation({ summary: "Promotions: create a voucher code" })
  createVoucher(@Body() dto: SaveVoucherDto) {
    return this.ops.createVoucher(dto);
  }

  @Patch("vouchers/:code")
  @AdminOnly("catalog")
  @ApiOperation({ summary: "Promotions: change or switch off a voucher" })
  updateVoucher(@Param("code") code: string, @Body() dto: UpdateVoucherDto) {
    return this.ops.updateVoucher(code, dto);
  }

  @Delete("vouchers/:code")
  @AdminOnly("catalog")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Promotions: delete a voucher (used ones are switched off instead)" })
  deleteVoucher(@Param("code") code: string) {
    return this.ops.deleteVoucher(code);
  }

  @Get("reviews")
  @AdminOnly("moderation", "catalog")
  @ApiOperation({ summary: "Moderation: recent reviews (delete with DELETE /admin/reviews/:id)" })
  reviews(@Query() q: PageQuery) {
    return this.ops.reviews(q);
  }

  // ----- Team & activity -----

  @Get("team")
  @AdminOnly("team")
  @ApiOperation({ summary: "Super admin: the admin team" })
  team() {
    return this.ops.team();
  }

  @Put("team")
  @AdminOnly("team")
  @ApiOperation({ summary: "Super admin: make an existing account an admin" })
  addAdmin(@Body() dto: AddAdminDto) {
    return this.ops.addAdmin(dto.email, dto.adminRole);
  }

  @Patch("team/:id")
  @AdminOnly("team")
  @ApiOperation({ summary: "Super admin: change an admin's role (null removes their access)" })
  setRole(@CurrentUser() me: AuthUser, @Param("id") id: string, @Body() dto: UpdateAdminDto) {
    return this.ops.setAdminRole(me.id, id, dto.adminRole);
  }

  @Get("audit")
  @AdminOnly("team")
  @ApiOperation({ summary: "Super admin: everything admins changed, newest first" })
  audit(@Query() q: PageQuery) {
    return this.ops.audit(q);
  }

  // ----- Announcements -----

  @Get("broadcasts/audience")
  @AdminOnly("content")
  @ApiOperation({ summary: "How many people each audience reaches" })
  audience() {
    return this.ops.audienceSizes();
  }

  @Post("broadcasts")
  @AdminOnly("content")
  @Idempotent()
  @ApiOperation({ summary: "Send an announcement or promotion to everyone, buyers or sellers (bell + phone push)" })
  broadcast(@Body() dto: BroadcastDto) {
    return this.ops.broadcast(dto);
  }
}
