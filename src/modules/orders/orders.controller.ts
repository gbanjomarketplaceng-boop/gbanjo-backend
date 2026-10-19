import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Idempotent } from "../../common/idempotency/idempotency.interceptor";
import { AdminGuard } from "../../common/guards/admin.guard";
import type { AuthUser } from "../auth/types/auth-user";
import { AdminListOrdersQuery, AdvanceOrderDto, CheckoutDto, CheckoutResultDto, CheckVoucherDto, ListOrdersQuery, OrderDto, VoucherDto } from "./dto/orders.dto";
import { OrdersService } from "./orders.service";

@ApiTags("Orders")
@ApiBearerAuth()
@Controller({ version: "1" })
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post("orders/checkout")
  @Idempotent()
  @ApiOperation({
    summary: "Buy your cart (or the items given). Wallet pays at once; for card/bank transfer/USSD open payment.checkoutUrl (Flutterwave).",
  })
  @ApiOkResponse({ type: CheckoutResultDto })
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.orders.checkout(user.id, dto);
  }

  @Get("orders")
  @ApiOperation({ summary: "Your orders: side=buy (you bought) or side=sell (sold from your listings)" })
  @ApiOkResponse({ type: [OrderDto] })
  list(@CurrentUser() user: AuthUser, @Query() q: ListOrdersQuery) {
    return this.orders.list(user, q.side, q.status);
  }

  @Get("orders/:id")
  @ApiOperation({ summary: "One order (buyer, seller or admin)" })
  @ApiOkResponse({ type: OrderDto })
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.orders.get(user, id);
  }

  @Post("orders/:id/advance")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Seller: move the order to the next stage (Packed → Shipped → Out for delivery → Delivered)" })
  @ApiOkResponse({ type: OrderDto })
  @Idempotent()
  advance(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: AdvanceOrderDto) {
    return this.orders.advance(user, id, dto.fromStage);
  }

  @Post("orders/:id/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Cancel before it ships (buyer or seller). The money goes back to the wallet or card it came from." })
  @ApiOkResponse({ type: OrderDto })
  @Idempotent()
  cancel(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.orders.cancel(user, id);
  }

  @Post("vouchers/check")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Check a voucher code before paying" })
  @ApiOkResponse({ type: VoucherDto })
  checkVoucher(@Body() dto: CheckVoucherDto) {
    return this.orders.voucher(dto.code);
  }

  @Get("admin/orders")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Admin: all orders (move Gbanjo-sold orders along with POST /orders/:id/advance)" })
  @ApiOkResponse({ type: [OrderDto] })
  adminList(@Query() q: AdminListOrdersQuery) {
    return this.orders.adminList(q.status);
  }
}
