import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Sse } from "@nestjs/common";
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Idempotent } from "../../common/idempotency/idempotency.interceptor";
import type { AuthUser } from "../auth/types/auth-user";
import { ChatEventsService } from "./chat-events.service";
import { ChatService } from "./chat.service";
import { ChatMessageDto, ConversationDto, MessagePageDto, MessagesQuery, SendMessageDto, StartConversationDto, ChatUnreadDto } from "./dto/chat.dto";

@ApiTags("Chat")
@Controller({ path: "chat", version: "1" })
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly events: ChatEventsService,
  ) {}

  @Sse("events")
  @ApiOperation({
    summary: "Live updates (Server-Sent Events)",
    description:
      "Keep this open while the app is in use. Each event's data is JSON with a `type`: " +
      "`message` (new message in one of your conversations — including your own, from another device), " +
      "`read` (someone read a conversation), `typing` (the other person is typing), `ping` (heartbeat every 25 s). " +
      "Reconnect if it drops; reload the conversation list after reconnecting.",
  })
  @ApiProduces("text/event-stream")
  stream(@CurrentUser() user: AuthUser) {
    return this.events.stream(user.id);
  }

  @Get("conversations")
  @ApiOperation({ summary: "My conversations (as buyer and as seller), newest first" })
  @ApiOkResponse({ type: [ConversationDto] })
  list(@CurrentUser() user: AuthUser) {
    return this.chat.list(user.id);
  }

  @Get("unread")
  @ApiOperation({ summary: "Total unread messages (for a badge)" })
  @ApiOkResponse({ type: ChatUnreadDto })
  unread(@CurrentUser() user: AuthUser) {
    return this.chat.unreadTotal(user.id);
  }

  @Post("conversations")
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: "Message the seller of a listing (opens the existing conversation if there is one)" })
  @ApiOkResponse({ type: ConversationDto })
  start(@CurrentUser() user: AuthUser, @Body() dto: StartConversationDto) {
    return this.chat.start(user.id, dto.productId, dto.text);
  }

  @Get("conversations/:id")
  @ApiOperation({ summary: "One conversation" })
  @ApiOkResponse({ type: ConversationDto })
  get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.chat.get(user.id, id);
  }

  @Get("conversations/:id/messages")
  @ApiOperation({ summary: "Messages, oldest first (latest page by default; use `before` to load older ones)" })
  @ApiOkResponse({ type: MessagePageDto })
  messages(@CurrentUser() user: AuthUser, @Param("id") id: string, @Query() q: MessagesQuery) {
    return this.chat.messages(user.id, id, q.before, q.limit);
  }

  @Post("conversations/:id/messages")
  @Idempotent()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: "Send a message (delivered live to both people)" })
  @ApiOkResponse({ type: ChatMessageDto })
  send(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() dto: SendMessageDto) {
    return this.chat.send(user.id, id, dto.text);
  }

  @Post("conversations/:id/read")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Mark the conversation read (the other person sees “Read”)" })
  @ApiNoContentResponse()
  read(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.chat.markRead(user.id, id);
  }

  @Post("conversations/:id/typing")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: "Tell the other person you're typing (send at most every few seconds)" })
  @ApiNoContentResponse()
  typing(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.chat.typing(user.id, id);
  }
}
