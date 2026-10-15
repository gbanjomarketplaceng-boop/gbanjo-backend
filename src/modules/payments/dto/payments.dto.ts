import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

/** Ways to pay on the Flutterwave page. */
export const CARD_METHODS = ["card", "bank-transfer", "ussd"] as const;

export class TopUpDto {
  @ApiProperty({ example: 5000, minimum: 1000, maximum: 500000, description: "Naira, whole amount" })
  @IsInt()
  @Min(1000)
  @Max(500000)
  amount!: number;

  @ApiPropertyOptional({ enum: CARD_METHODS, default: "card", description: "Payment option shown on the Flutterwave page" })
  @IsOptional()
  @IsIn(CARD_METHODS)
  method?: (typeof CARD_METHODS)[number];

  @ApiPropertyOptional({
    example: "https://www.gbanjomarket.com/profile/wallet/success?amount=5000",
    description: "Page to come back to after paying (a website origin from CORS_ORIGINS, or a gbanjo:// / exp:// app link). `reference` and `status` are added to it.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  returnUrl?: string;
}

export class VerifyPaymentDto {
  @ApiPropertyOptional({ example: "cancelled", description: "The status the payment page reported, if any" })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;
}

export class PaymentDto {
  @ApiProperty({ example: "GBJ-MGQ3K2X1-8F2A9C" }) reference!: string;
  @ApiProperty({ enum: ["order", "top-up"] }) purpose!: "order" | "top-up";
  @ApiProperty({ enum: ["pending", "successful", "failed", "canceled"] }) status!: "pending" | "successful" | "failed" | "canceled";
  @ApiProperty({ example: "card", description: "card | bank-transfer | ussd | wallet" }) method!: string;
  @ApiProperty({ example: 17000 }) amount!: number;
  @ApiProperty({ example: "NGN" }) currency!: string;
  @ApiPropertyOptional({ nullable: true, description: "Flutterwave payment page — open it while the payment is pending" }) checkoutUrl!: string | null;
  @ApiPropertyOptional({ nullable: true }) failureReason!: string | null;
  @ApiPropertyOptional({ nullable: true }) paidAt!: Date | null;
  @ApiProperty() createdAt!: Date;
  @ApiProperty({ type: [String], description: "Orders this payment is for (checkout only)" }) orderIds!: string[];
}
