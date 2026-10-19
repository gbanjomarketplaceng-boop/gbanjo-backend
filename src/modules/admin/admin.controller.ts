import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AdminOnly } from "../../common/admin/admin-areas";
import { Idempotent } from "../../common/idempotency/idempotency.interceptor";
import { WithdrawalsService } from "../payments/withdrawals.service";
import { RejectWithdrawalDto } from "./dto/admin-ops.dto";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { AdminGuard } from "../../common/guards/admin.guard";
import type { AuthUser } from "../auth/types/auth-user";
import { AdminService } from "./admin.service";
import {
  AdminReportDto,
  AdminReportsQuery,
  AdminUserDto,
  AdminUsersQuery,
  AdminWithdrawalsQuery,
  OverviewDto,
  UpdateProductStatusDto,
  UpdateReportDto,
  UpdateUserStatusDto,
} from "./dto/admin.dto";

@ApiTags("Admin")
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller({ path: "admin", version: "1" })
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly withdrawalsSvc: WithdrawalsService,
  ) {}

  @Get("overview")
  @AdminOnly("dashboard")
  @ApiOperation({ summary: "Admin: counts for the dashboard (what needs attention)" })
  @ApiOkResponse({ type: OverviewDto })
  overview() {
    return this.admin.overview();
  }

  @Get("users")
  @AdminOnly("users", "finance")
  @ApiOperation({ summary: "Admin: find people (newest first, up to 100)" })
  @ApiOkResponse({ type: [AdminUserDto] })
  users(@Query() q: AdminUsersQuery) {
    return this.admin.users(q.q, q.status);
  }

  @Patch("users/:id")
  @AdminOnly("users")
  @ApiOperation({ summary: "Admin: suspend or reactivate someone" })
  @ApiOkResponse({ type: AdminUserDto })
  setUserStatus(@CurrentUser() me: AuthUser, @Param("id") id: string, @Body() dto: UpdateUserStatusDto) {
    return this.admin.setUserStatus(me.id, id, dto.status);
  }

  @Get("reports")
  @AdminOnly("moderation")
  @ApiOperation({ summary: "Admin: reported listings and people" })
  @ApiOkResponse({ type: [AdminReportDto] })
  reports(@Query() q: AdminReportsQuery) {
    return this.admin.reports(q.status);
  }

  @Patch("reports/:id")
  @AdminOnly("moderation")
  @ApiOperation({ summary: "Admin: resolve or dismiss a report" })
  @ApiOkResponse({ type: AdminReportDto })
  updateReport(@Param("id") id: string, @Body() dto: UpdateReportDto) {
    return this.admin.updateReport(id, dto.status, dto.note);
  }

  @Patch("products/:slug")
  @AdminOnly("moderation", "catalog")
  @ApiOperation({ summary: "Admin: take a listing down (hidden) or put it back (active)" })
  setProductStatus(@Param("slug") slug: string, @Body() dto: UpdateProductStatusDto) {
    return this.admin.setProductStatus(slug, dto.status);
  }

  @Get("withdrawals")
  @AdminOnly("finance")
  @ApiOperation({ summary: "Admin: withdrawals to banks" })
  withdrawals(@Query() q: AdminWithdrawalsQuery) {
    return this.admin.withdrawals(q.status);
  }

  @Post("withdrawals/:id/approve")
  @AdminOnly("finance")
  @Idempotent()
  @ApiOperation({ summary: "Finance: send a withdrawal that was waiting for approval" })
  approveWithdrawal(@Param("id") id: string) {
    return this.withdrawalsSvc.approve(id);
  }

  @Post("withdrawals/:id/reject")
  @AdminOnly("finance")
  @Idempotent()
  @ApiOperation({ summary: "Finance: refuse a withdrawal that was waiting; the money goes back to the wallet" })
  rejectWithdrawal(@Param("id") id: string, @Body() dto: RejectWithdrawalDto) {
    return this.withdrawalsSvc.reject(id, dto.reason);
  }
}
