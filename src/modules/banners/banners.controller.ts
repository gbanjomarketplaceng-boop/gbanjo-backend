import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiForbiddenResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CacheFor } from "../../common/cache/response-cache.interceptor";
import { Public } from "../../common/decorators/public.decorator";
import { AdminGuard } from "../../common/guards/admin.guard";
import { BannersService } from "./banners.service";
import { AdminBannerDto, BannerDto, CreateBannerDto, UpdateBannerDto } from "./dto/banner.dto";

@ApiTags("Banners")
@Controller({ version: "1" })
export class BannersController {
  constructor(private readonly banners: BannersService) {}

  @Public()
  @CacheFor(60)
  @Get("banners")
  @ApiOperation({ summary: "Home-page slides that are live right now" })
  @ApiOkResponse({ type: [BannerDto] })
  live() {
    return this.banners.live();
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Get("admin/banners")
  @ApiOperation({ summary: "Admin: every banner, including hidden and scheduled ones" })
  @ApiOkResponse({ type: [AdminBannerDto] })
  @ApiForbiddenResponse({ description: "ADMIN_ONLY" })
  all() {
    return this.banners.all();
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Post("admin/banners")
  @ApiOperation({ summary: "Admin: add a banner (upload its image with purpose=banner first)" })
  @ApiOkResponse({ type: AdminBannerDto })
  create(@Body() dto: CreateBannerDto) {
    return this.banners.create(dto);
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Patch("admin/banners/:id")
  @ApiOperation({ summary: "Admin: change a banner (text, image, order, on/off, schedule)" })
  @ApiOkResponse({ type: AdminBannerDto })
  update(@Param("id") id: string, @Body() dto: UpdateBannerDto) {
    return this.banners.update(id, dto);
  }

  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  @Delete("admin/banners/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Admin: delete a banner" })
  @ApiNoContentResponse()
  async remove(@Param("id") id: string) {
    await this.banners.remove(id);
  }
}
