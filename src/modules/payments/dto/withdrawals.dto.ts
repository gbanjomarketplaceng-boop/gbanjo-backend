import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsString, Matches, Max, MaxLength, Min } from "class-validator";

export class BankDto {
  @ApiProperty({ example: "044" }) code!: string;
  @ApiProperty({ example: "Access Bank" }) name!: string;
}

export class SaveBankAccountDto {
  @ApiProperty({ example: "044", description: "Bank code from GET /wallet/banks" })
  @IsString()
  @MaxLength(20)
  bankCode!: string;

  @ApiProperty({ example: "0690000032", description: "10-digit NUBAN account number" })
  @Matches(/^\d{10}$/, { message: "Enter the 10-digit account number" })
  accountNumber!: string;
}

export class BankAccountDto {
  @ApiProperty({ example: "044" }) bankCode!: string;
  @ApiProperty({ example: "Access Bank" }) bankName!: string;
  @ApiProperty({ example: "0690000032" }) accountNumber!: string;
  @ApiProperty({ example: "ADA OBI" }) accountName!: string;
}

export class WithdrawDto {
  @ApiProperty({ example: 5000, description: "Naira, whole amount (at least WITHDRAWAL_MIN, at most your balance)" })
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amount!: number;
}

export class WithdrawalDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: "WDR-MGQ3K2X1-8F2A9C" }) reference!: string;
  @ApiProperty({ example: 5000 }) amount!: number;
  @ApiProperty({ enum: ["awaiting_approval", "pending", "processing", "successful", "failed"] }) status!: string;
  @ApiProperty({ example: "Access Bank" }) bankName!: string;
  @ApiProperty({ example: "******0032", description: "Last 4 digits only" }) accountNumber!: string;
  @ApiProperty({ example: "ADA OBI" }) accountName!: string;
  @ApiPropertyOptional({ nullable: true }) failureReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) completedAt!: Date | null;
  @ApiProperty() createdAt!: Date;
}
