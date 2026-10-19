import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsNumber, IsOptional, Max, Min } from "class-validator";

export class BusinessSettingsDto {
  @ApiProperty({ example: 5, description: "Commission on each delivered sale (% of the items)" }) platformFeePercent!: number;
  @ApiProperty({ example: 12000, description: "Express delivery fee (₦)" }) expressShippingFee!: number;
  @ApiProperty({ example: 3, description: "Days seller earnings are held after delivery" }) payoutHoldDays!: number;
  @ApiProperty({ example: 1000, description: "Smallest withdrawal (₦)" }) withdrawalMin!: number;
  @ApiProperty({ example: 200000, description: "Withdrawals above this need approval (0 = never)" }) withdrawalApprovalAbove!: number;
}

export class PublicSettingsDto {
  @ApiProperty({ example: 12000 }) expressShippingFee!: number;
  @ApiProperty({ example: 1000 }) withdrawalMin!: number;
}

export class UpdateSettingsDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 50 }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(50) platformFeePercent?: number;
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000) expressShippingFee?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 60 }) @IsOptional() @IsInt() @Min(0) @Max(60) payoutHoldDays?: number;
  @ApiPropertyOptional({ minimum: 100 }) @IsOptional() @IsInt() @Min(100) @Max(10_000_000) withdrawalMin?: number;
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) withdrawalApprovalAbove?: number;
}
