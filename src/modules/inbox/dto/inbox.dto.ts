import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { Type } from "class-transformer";

export class NotificationDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: "order", description: "order | payment | seller | message | withdrawal | account" }) type!: string;
  @ApiProperty({ example: "Order #92287157 shipped" }) title!: string;
  @ApiProperty({ example: "Your order is on its way." }) body!: string;
  @ApiPropertyOptional({ nullable: true, example: "/orders/92287157", description: "Where tapping it goes (same path on web and app)" }) href!: string | null;
  @ApiProperty() read!: boolean;
  @ApiProperty() createdAt!: Date;
}

export class NotificationPageDto {
  @ApiProperty({ type: [NotificationDto] }) items!: NotificationDto[];
  @ApiProperty({ example: 2 }) unread!: number;
  @ApiProperty() hasMore!: boolean;
}

export class ListNotificationsQuery {
  @ApiPropertyOptional({ description: "Older than this time (createdAt of the last item you have)" })
  @IsOptional()
  @IsISO8601()
  before?: string;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class MarkReadDto {
  @ApiPropertyOptional({ type: [String], description: "Leave out to mark everything read" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids?: string[];
}

export class PushTokenDto {
  @ApiProperty({ example: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" })
  @IsString()
  @MaxLength(200)
  token!: string;

  @ApiPropertyOptional({ enum: ["ios", "android"] })
  @IsOptional()
  @IsIn(["ios", "android"])
  platform?: "ios" | "android";
}

export class PreferencesDto {
  @ApiProperty({ description: "Order, payment and wallet updates (push + email updates about shipping)" }) orderUpdates!: boolean;
  @ApiProperty({ description: "New chat messages (push)" }) messages!: boolean;
  @ApiProperty({ description: "Offers and new finds" }) offers!: boolean;
  @ApiProperty({ description: "Use browsing to suggest items" }) personalised!: boolean;
  @ApiProperty({ description: "Share anonymous usage data" }) analytics!: boolean;
}

export class UpdatePreferencesDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() orderUpdates?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() messages?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() offers?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() personalised?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() analytics?: boolean;
}

export class UnreadDto {
  @ApiProperty({ example: 2 }) unread!: number;
}
