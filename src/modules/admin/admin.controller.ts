import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
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
  constructor(private readonly admin: AdminService) {}

  @Get("overview")
  @ApiOperation({ summary: "Admin: counts for the dashboard (what needs attention)" })
  @ApiOkResponse({ type: OverviewDto })
  overview() {
    return this.admin.overview();
  }

  @Get("users")
  @ApiOperation({ summary: "Admin: find people (newest first, up to 100)" })
  @ApiOkResponse({ type: [AdminUserDto] })
  users(@Query() q: AdminUsersQuery) {
    return this.admin.users(q.q, q.status);
  }

  @Patch("users/:id")
  @ApiOperation({ summary: "Admin: suspend or reactivate someone" })
  @ApiOkResponse({ type: AdminUserDto })
  setUserStatus(@CurrentUser() me: AuthUser, @Param("id") id: string, @Body() dto: UpdateUserStatusDto) {
    return this.admin.setUserStatus(me.id, id, dto.status);
  }

  @Get("reports")
  @ApiOperation({ summary: "Admin: reported listings and people" })
  @ApiOkResponse({ type: [AdminReportDto] })
  reports(@Query() q: AdminReportsQuery) {
    return this.admin.reports(q.status);
  }

  @Patch("reports/:id")
  @ApiOperation({ summary: "Admin: resolve or dismiss a report" })
  @ApiOkResponse({ type: AdminReportDto })
  updateReport(@Param("id") id: string, @Body() dto: UpdateReportDto) {
    return this.admin.updateReport(id, dto.status, dto.note);
  }

  @Patch("products/:slug")
  @ApiOperation({ summary: "Admin: take a listing down (hidden) or put it back (active)" })
  setProductStatus(@Param("slug") slug: string, @Body() dto: UpdateProductStatusDto) {
    return this.admin.setProductStatus(slug, dto.status);
  }

  @Get("withdrawals")
  @ApiOperation({ summary: "Admin: withdrawals to banks" })
  withdrawals(@Query() q: AdminWithdrawalsQuery) {
    return this.admin.withdrawals(q.status);
  }
}
