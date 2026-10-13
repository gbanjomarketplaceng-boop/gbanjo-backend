import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { CartService } from "./cart.service";
import { AddCartItemDto, CartDto, MergeCartDto, UpdateCartItemDto } from "./dto/cart.dto";

@ApiTags("Cart")
@ApiBearerAuth()
@Controller({ path: "cart", version: "1" })
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({ summary: "The signed-in user's cart" })
  @ApiOkResponse({ type: CartDto })
  get(@CurrentUser() user: AuthUser) {
    return this.cart.get(user.id);
  }

  @Post("items")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Add an item (adds to the quantity if it's already in the cart)" })
  @ApiOkResponse({ type: CartDto })
  add(@CurrentUser() user: AuthUser, @Body() dto: AddCartItemDto) {
    return this.cart.add(user.id, dto);
  }

  @Patch("items/:productId")
  @ApiOperation({ summary: "Change an item's quantity or option" })
  @ApiOkResponse({ type: CartDto })
  update(@CurrentUser() user: AuthUser, @Param("productId") productId: string, @Body() dto: UpdateCartItemDto) {
    return this.cart.update(user.id, productId, dto);
  }

  @Delete("items/:productId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove an item" })
  @ApiNoContentResponse()
  remove(@CurrentUser() user: AuthUser, @Param("productId") productId: string) {
    return this.cart.remove(user.id, productId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Empty the cart" })
  @ApiNoContentResponse()
  clear(@CurrentUser() user: AuthUser) {
    return this.cart.clear(user.id);
  }

  @Post("merge")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "After sign-in: bring in the cart kept on this device while signed out" })
  @ApiOkResponse({ type: CartDto })
  merge(@CurrentUser() user: AuthUser, @Body() dto: MergeCartDto) {
    return this.cart.merge(user.id, dto.items);
  }
}
