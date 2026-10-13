import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { WalletService } from "./wallet.service";

class WalletResponseDto {
  @ApiProperty({ example: "0.00" }) balance!: string;
  @ApiProperty({ example: "NGN" }) currency!: string;
  @ApiProperty() updatedAt!: Date;
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
}
