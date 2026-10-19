import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put, Query, UseGuards } from "@nestjs/common";
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { AdminOnly } from "../../common/admin/admin-areas";
import { AdminGuard } from "../../common/guards/admin.guard";
import type { AuthUser } from "../auth/types/auth-user";
import { MyReviewDto, ReviewDto, ReviewPageDto, ReviewsQuery, SaveReviewDto } from "./dto/review.dto";
import { ReviewsService } from "./reviews.service";

@ApiTags("Reviews")
@Controller({ version: "1" })
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get("products/:id/reviews")
  @ApiOperation({ summary: "A product's reviews with the rating summary (average, count, stars breakdown)" })
  @ApiOkResponse({ type: ReviewPageDto })
  list(@Param("id") id: string, @Query() q: ReviewsQuery) {
    return this.reviews.list(id, q.sort, q.page, q.limit);
  }

  @Get("products/:id/reviews/mine")
  @ApiOperation({ summary: "My review of this product (null if none) and whether I may review it" })
  @ApiOkResponse({ type: MyReviewDto })
  mine(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.reviews.mine(user.id, id);
  }

  @Put("products/:id/reviews/mine")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "Rate / review a product (one per person; sending again updates it)" })
  @ApiOkResponse({ type: ReviewDto })
  save(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: SaveReviewDto) {
    return this.reviews.save(user.id, id, dto.rating, dto.text);
  }

  @Delete("products/:id/reviews/mine")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete my review" })
  @ApiNoContentResponse()
  remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.reviews.remove(user.id, id);
  }

  @UseGuards(AdminGuard)
  @AdminOnly("moderation", "catalog")
  @Delete("admin/reviews/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Admin: remove a review" })
  @ApiNoContentResponse()
  adminRemove(@Param("id") id: string) {
    return this.reviews.removeById(id);
  }
}
