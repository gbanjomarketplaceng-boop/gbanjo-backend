import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class OverviewDto {
  @ApiProperty() users!: number;
  @ApiProperty({ description: "Seller IDs waiting for review" }) pendingVerifications!: number;
  @ApiProperty() openReports!: number;
  @ApiProperty({ description: "Contact-page messages not resolved yet" }) newContactMessages!: number;
  @ApiProperty() ongoingOrders!: number;
  @ApiProperty({ description: "Withdrawals still being processed" }) pendingWithdrawals!: number;
}

export class AdminUsersQuery {
  @ApiPropertyOptional({ description: "Name, email or phone" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ["active", "suspended", "deleted"] })
  @IsOptional()
  @IsIn(["active", "suspended", "deleted"])
  status?: "active" | "suspended" | "deleted";
}

export class AdminUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiPropertyOptional({ nullable: true }) phone!: string | null;
  @ApiProperty({ enum: ["user", "admin"] }) role!: string;
  @ApiProperty({ enum: ["active", "suspended", "deleted"] }) status!: string;
  @ApiProperty({ enum: ["none", "pending", "verified", "rejected"] }) seller!: string;
  @ApiProperty() listings!: number;
  @ApiProperty() orders!: number;
  @ApiProperty({ description: "Times others reported this person" }) reports!: number;
  @ApiProperty() createdAt!: Date;
  @ApiPropertyOptional({ nullable: true }) lastLoginAt!: Date | null;
}

export class UpdateUserStatusDto {
  @ApiProperty({ enum: ["active", "suspended"], description: "Suspending signs them out everywhere and stops sign-in" })
  @IsIn(["active", "suspended"])
  status!: "active" | "suspended";
}

export class AdminReportsQuery {
  @ApiPropertyOptional({ enum: ["open", "resolved", "dismissed"] })
  @IsOptional()
  @IsIn(["open", "resolved", "dismissed"])
  status?: "open" | "resolved" | "dismissed";
}

export class AdminReportDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ["product", "user"] }) type!: string;
  @ApiProperty() reason!: string;
  @ApiProperty() details!: string;
  @ApiProperty({ enum: ["open", "resolved", "dismissed"] }) status!: string;
  @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @ApiProperty() reporter!: { id: string; name: string };
  @ApiPropertyOptional({ nullable: true, description: "Reported listing" }) product!: { id: string; name: string; status: string; image: string } | null;
  @ApiPropertyOptional({ nullable: true, description: "Reported person (or the listing's seller)" }) user!: { id: string; name: string; status: string } | null;
  @ApiProperty() createdAt!: Date;
  @ApiPropertyOptional({ nullable: true }) resolvedAt!: Date | null;
}

export class UpdateReportDto {
  @ApiProperty({ enum: ["resolved", "dismissed", "open"] })
  @IsIn(["resolved", "dismissed", "open"])
  status!: "resolved" | "dismissed" | "open";

  @ApiPropertyOptional({ description: "What you did" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateProductStatusDto {
  @ApiProperty({ enum: ["active", "hidden"], description: "hidden takes the listing off the site (the seller sees it as a draft)" })
  @IsIn(["active", "hidden"])
  status!: "active" | "hidden";
}

export class AdminWithdrawalsQuery {
  @ApiPropertyOptional({ enum: ["pending", "processing", "successful", "failed"] })
  @IsOptional()
  @IsIn(["pending", "processing", "successful", "failed"])
  status?: "pending" | "processing" | "successful" | "failed";
}
