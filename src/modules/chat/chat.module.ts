import { Module } from "@nestjs/common";
import { ChatEventsService } from "./chat-events.service";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";

@Module({ controllers: [ChatController], providers: [ChatService, ChatEventsService] })
export class ChatModule {}
