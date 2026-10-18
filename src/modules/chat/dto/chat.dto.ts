import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min } from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

export const MAX_MESSAGE_LENGTH = 2000;

export class StartConversationDto {
  @ApiProperty({ example: "iphone-13-pro-256gb-k3x9qa", description: "Product id (slug) of the listing you're asking about" })
  @IsString()
  @Length(1, 120)
  productId!: string;

  @ApiPropertyOptional({ example: "Hi! Is this still available?", description: "First message (optional)" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, MAX_MESSAGE_LENGTH, { message: `Messages can be up to ${MAX_MESSAGE_LENGTH} characters` })
  text?: string;
}

export class SendMessageDto {
  @ApiProperty({ example: "Yes, it's still available." })
  @Transform(trim)
  @IsString()
  @Length(1, MAX_MESSAGE_LENGTH, { message: `Write a message (up to ${MAX_MESSAGE_LENGTH} characters)` })
  text!: string;
}

export class MessagesQuery {
  @ApiPropertyOptional({ description: "Load messages older than this time (ISO date) — for scrolling back" })
  @IsOptional()
  @IsISO8601()
  before?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}

export class ChatMessageDto {
  @ApiProperty() id!: string;
  @ApiProperty() conversationId!: string;
  @ApiProperty({ description: "Compare with your own user id to tell your messages apart" }) senderId!: string;
  @ApiProperty() text!: string;
  @ApiProperty() createdAt!: Date;
}

export class ChatPartyDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: "Amara O." }) name!: string;
  @ApiPropertyOptional() avatar?: string;
}

export class ChatProductDto {
  @ApiProperty({ example: "iphone-13-pro-256gb-k3x9qa", description: "Slug (/products/:id)" }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() price!: number;
  @ApiProperty() location!: string;
  @ApiProperty() photo!: string;
  @ApiProperty({ enum: ["active", "sold", "draft"] }) status!: string;
}

export class ConversationDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ["buyer", "seller"], description: "Your side of this conversation" }) role!: "buyer" | "seller";
  @ApiProperty({ type: ChatPartyDto, description: "The person you're talking to" }) other!: ChatPartyDto;
  @ApiPropertyOptional({ type: ChatProductDto, nullable: true }) product!: ChatProductDto | null;
  @ApiPropertyOptional({ type: ChatMessageDto, nullable: true }) lastMessage!: ChatMessageDto | null;
  @ApiProperty({ description: "Messages from the other person you haven't read" }) unread!: number;
  @ApiProperty() lastMessageAt!: Date;
  @ApiPropertyOptional({ nullable: true, type: Date, description: "Your messages up to this time have been read" }) otherLastReadAt!: Date | null;
  @ApiProperty({ description: "You blocked this person (neither of you can send messages)" }) blockedByMe!: boolean;
  @ApiProperty({ description: "This person blocked you" }) blockedMe!: boolean;
}

export class MessagePageDto {
  @ApiProperty({ type: [ChatMessageDto], description: "Oldest first" }) items!: ChatMessageDto[];
  @ApiProperty({ description: "There are older messages (pass before=<items[0].createdAt>)" }) hasMore!: boolean;
}

export class UnreadDto {
  @ApiProperty() unread!: number;
}

/** Pushed on GET /chat/events (Server-Sent Events). `type` says which. */
export type ChatEvent =
  | { type: "message"; conversationId: string; message: ChatMessageDto }
  | { type: "read"; conversationId: string; readerId: string; readAt: string }
  | { type: "typing"; conversationId: string; userId: string }
  | { type: "ping" };

