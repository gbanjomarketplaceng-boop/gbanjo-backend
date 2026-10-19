import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminOnly } from "../../common/admin/admin-areas";
import { CacheFor } from "../../common/cache/response-cache.interceptor";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { AdminGuard } from "../../common/guards/admin.guard";
import type { AuthUser } from "../auth/types/auth-user";
import { BusinessSettingsDto, PublicSettingsDto, UpdateSettingsDto } from "./dto/settings.dto";
import { SettingsService } from "./settings.service";

@ApiTags("Settings")
@Controller({ version: "1" })
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @CacheFor(30)
  @Get("settings/public")
  @ApiOperation({ summary: "Settings the website and app show (e.g. the express delivery fee)" })
  @ApiOkResponse({ type: PublicSettingsDto })
  async public(): Promise<PublicSettingsDto> {
    const s = await this.settings.get();
    return { expressShippingFee: s.expressShippingFee, withdrawalMin: s.withdrawalMin };
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @AdminOnly("settings", "finance")
  @Get("admin/settings")
  @ApiOperation({ summary: "Admin: business settings" })
  @ApiOkResponse({ type: BusinessSettingsDto })
  get() {
    return this.settings.get();
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @AdminOnly("settings")
  @Patch("admin/settings")
  @ApiOperation({ summary: "Super admin: change business settings (takes effect within seconds)" })
  @ApiOkResponse({ type: BusinessSettingsDto })
  update(@CurrentUser() me: AuthUser, @Body() dto: UpdateSettingsDto) {
    return this.settings.update(dto, me.id);
  }
}
