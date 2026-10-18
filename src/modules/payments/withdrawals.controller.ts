import { Body, Controller, Get, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { BankAccountDto, BankDto, SaveBankAccountDto, WithdrawalDto, WithdrawDto } from "./dto/withdrawals.dto";
import { WithdrawalsService } from "./withdrawals.service";

@ApiTags("Wallet")
@ApiBearerAuth()
@Controller({ path: "wallet", version: "1" })
export class WithdrawalsController {
  constructor(private readonly withdrawals: WithdrawalsService) {}

  @Get("banks")
  @ApiOperation({ summary: "Nigerian banks you can withdraw to" })
  @ApiOkResponse({ type: [BankDto] })
  banks() {
    return this.withdrawals.banks();
  }

  @Get("bank-account")
  @ApiOperation({ summary: "Your saved bank account (null if none)" })
  @ApiOkResponse({ type: BankAccountDto })
  bankAccount(@CurrentUser() user: AuthUser) {
    return this.withdrawals.bankAccount(user.id);
  }

  @Put("bank-account")
  @ApiOperation({ summary: "Save the bank account withdrawals go to (the bank confirms the account name)" })
  @ApiOkResponse({ type: BankAccountDto })
  saveBankAccount(@CurrentUser() user: AuthUser, @Body() dto: SaveBankAccountDto) {
    return this.withdrawals.saveBankAccount(user.id, dto);
  }

  @Get("withdrawals")
  @ApiOperation({ summary: "Your withdrawals, newest first" })
  @ApiOkResponse({ type: [WithdrawalDto] })
  list(@CurrentUser() user: AuthUser) {
    return this.withdrawals.list(user.id);
  }

  @Post("withdrawals")
  @ApiOperation({ summary: "Send money from your wallet to your saved bank account" })
  @ApiCreatedResponse({ type: WithdrawalDto })
  withdraw(@CurrentUser() user: AuthUser, @Body() dto: WithdrawDto) {
    return this.withdrawals.withdraw(user.id, dto.amount);
  }
}
