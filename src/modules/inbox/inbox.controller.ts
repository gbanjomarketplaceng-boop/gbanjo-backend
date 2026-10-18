import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { ListNotificationsQuery, MarkReadDto, NotificationPageDto, PreferencesDto, PushTokenDto, UnreadDto, UpdatePreferencesDto } from "./dto/inbox.dto";
import { InboxService } from "./inbox.service";

@ApiTags("Notifications")
@ApiBearerAuth()
@Controller({ path: "notifications", version: "1" })
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @ApiOperation({ summary: "Your notifications, newest first (with the unread count)" })
  @ApiOkResponse({ type: NotificationPageDto })
  list(@CurrentUser() user: AuthUser, @Query() q: ListNotificationsQuery) {
    return this.inbox.list(user.id, q.before, q.limit);
  }

  @Get("unread")
  @ApiOperation({ summary: "How many notifications are unread (for the badge)" })
  @ApiOkResponse({ type: UnreadDto })
  unread(@CurrentUser() user: AuthUser) {
    return this.inbox.unread(user.id);
  }

  @Post("read")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark notifications read (all of them when no ids are given)" })
  @ApiOkResponse({ type: UnreadDto })
  read(@CurrentUser() user: AuthUser, @Body() dto: MarkReadDto) {
    return this.inbox.markRead(user.id, dto.ids);
  }

  @Put("push-token")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "App: save this phone's Expo push token" })
  @ApiNoContentResponse()
  addToken(@CurrentUser() user: AuthUser, @Body() dto: PushTokenDto) {
    return this.inbox.addPushToken(user.id, dto.token, dto.platform);
  }

  @Delete("push-token")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "App: stop pushes to this phone (on sign-out)" })
  @ApiNoContentResponse()
  removeToken(@CurrentUser() user: AuthUser, @Body() dto: PushTokenDto) {
    return this.inbox.removePushToken(user.id, dto.token);
  }

  @Get("preferences")
  @ApiOperation({ summary: "Your notification and privacy settings" })
  @ApiOkResponse({ type: PreferencesDto })
  preferences(@CurrentUser() user: AuthUser) {
    return this.inbox.preferences(user.id);
  }

  @Patch("preferences")
  @ApiOperation({ summary: "Change notification and privacy settings (only the ones you send)" })
  @ApiOkResponse({ type: PreferencesDto })
  updatePreferences(@CurrentUser() user: AuthUser, @Body() dto: UpdatePreferencesDto) {
    return this.inbox.updatePreferences(user.id, dto);
  }
}
