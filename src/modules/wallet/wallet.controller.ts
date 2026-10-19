import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { WalletService } from "./wallet.service";

class WalletResponseDto {
  @ApiProperty({ example: "0.00" }) balance!: string;
  @ApiProperty({ example: "0.00", description: "Seller earnings on hold until their payout date" }) pending!: string;
  @ApiProperty({ example: "NGN" }) currency!: string;
  @ApiProperty() updatedAt!: Date;
}

class WalletTransactionDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ["top-up", "order-payment", "refund", "sale", "withdrawal", "adjustment"] }) type!: string;
  @ApiProperty({ enum: ["pending", "completed"] }) status!: string;
  @ApiProperty({ example: 5000, description: "Positive = money in, negative = money out" }) amount!: number;
  @ApiProperty({ example: "Wallet top-up" }) description!: string;
  @ApiProperty() reference!: string;
  @ApiPropertyOptional({ nullable: true }) orderId!: string | null;
  @ApiPropertyOptional({ nullable: true }) availableAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}

@ApiTags("Wallet")
@ApiBearerAuth()
@Controller({ path: "wallet", version: "1" })
export class WalletController {
  constructor(private readonly wallets: WalletService) {}

  @Get()
  @ApiOperation({ summary: "The signed-in user's wallet balance" })
  @ApiOkResponse({ type: WalletResponseDto })
  get(@CurrentUser() user: AuthUser) {
    return this.wallets.forUser(user.id);
  }

  @Get("transactions")
  @ApiOperation({ summary: "Latest wallet activity (top-ups, payments, refunds, sales)" })
  @ApiOkResponse({ type: [WalletTransactionDto] })
  transactions(@CurrentUser() user: AuthUser) {
    return this.wallets.transactions(user.id);
  }
}
