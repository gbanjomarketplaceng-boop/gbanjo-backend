import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export const REPORT_REASONS = ["scam", "fake", "prohibited", "offensive", "other"] as const;

export class CreateReportDto {
  @ApiProperty({ enum: ["product", "user"] })
  @IsIn(["product", "user"])
  type!: "product" | "user";

  @ApiProperty({ example: "olive-low-top-sneakers", description: "Product slug, or the user's id" })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  id!: string;

  @ApiProperty({ enum: REPORT_REASONS, description: "scam · fake/counterfeit · prohibited item · offensive · other" })
  @IsIn(REPORT_REASONS)
  reason!: (typeof REPORT_REASONS)[number];

  @ApiPropertyOptional({ example: "Asked me to pay outside Gbanjo." })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}

export class ReportCreatedDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: "open" }) status!: string;
}

export class BlockedUserDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: "Femi T." }) name!: string;
  @ApiPropertyOptional() avatar?: string;
  @ApiProperty() blockedAt!: Date;
}
