import { Global, Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { InboxController } from "./inbox.controller";
import { InboxService } from "./inbox.service";

/** In-app notifications, phone pushes and notification settings. Global so any module can call notify(). */
@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
