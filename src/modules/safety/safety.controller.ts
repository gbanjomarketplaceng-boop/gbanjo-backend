import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { BlockedUserDto, CreateReportDto, ReportCreatedDto } from "./dto/safety.dto";
import { SafetyService } from "./safety.service";

@ApiTags("Reports & blocking")
@ApiBearerAuth()
@Controller({ version: "1" })
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Post("reports")
  @ApiOperation({ summary: "Report a listing or a person to the Gbanjo team" })
  @ApiCreatedResponse({ type: ReportCreatedDto })
  report(@CurrentUser() user: AuthUser, @Body() dto: CreateReportDto) {
    return this.safety.report(user.id, dto);
  }

  @Get("blocks")
  @ApiOperation({ summary: "People you've blocked" })
  @ApiOkResponse({ type: [BlockedUserDto] })
  blocks(@CurrentUser() user: AuthUser) {
    return this.safety.blocks(user.id);
  }

  @Put("blocks/:userId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Block someone: neither of you can message the other" })
  @ApiNoContentResponse()
  block(@CurrentUser() user: AuthUser, @Param("userId") userId: string) {
    return this.safety.block(user.id, userId);
  }

  @Delete("blocks/:userId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Unblock someone" })
  @ApiNoContentResponse()
  unblock(@CurrentUser() user: AuthUser, @Param("userId") userId: string) {
    return this.safety.unblock(user.id, userId);
  }
}
