import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { ProductDto } from "../catalog/dto/catalog.dto";
import { MergeWishlistDto } from "./dto/wishlist.dto";
import { WishlistService } from "./wishlist.service";

@ApiTags("Wishlist")
@ApiBearerAuth()
@Controller({ path: "wishlist", version: "1" })
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get()
  @ApiOperation({ summary: "Saved items (oldest first)" })
  @ApiOkResponse({ type: [ProductDto] })
  list(@CurrentUser() user: AuthUser) {
    return this.wishlist.list(user.id);
  }

  @Put(":productId")
  @ApiOperation({ summary: "Save an item (no-op if already saved). Returns the whole wishlist." })
  @ApiOkResponse({ type: [ProductDto] })
  add(@CurrentUser() user: AuthUser, @Param("productId") productId: string) {
    return this.wishlist.add(user.id, productId);
  }

  @Delete(":productId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove a saved item" })
  @ApiNoContentResponse()
  remove(@CurrentUser() user: AuthUser, @Param("productId") productId: string) {
    return this.wishlist.remove(user.id, productId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Empty the wishlist" })
  @ApiNoContentResponse()
  clear(@CurrentUser() user: AuthUser) {
    return this.wishlist.clear(user.id);
  }

  @Post("merge")
  @ApiOperation({ summary: "After sign-in: add the items saved on this device while signed out" })
  @ApiOkResponse({ type: [ProductDto] })
  merge(@CurrentUser() user: AuthUser, @Body() dto: MergeWishlistDto) {
    return this.wishlist.merge(user.id, dto.productIds);
  }
}
