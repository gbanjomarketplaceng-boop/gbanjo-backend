import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmailChannel, SmsChannel } from "./channels/channel.interfaces";
import { createEmailChannel } from "./channels/email/email-channel.factory";
import { createSmsChannel } from "./channels/sms/sms-channel.factory";
import { NOTIFICATIONS_QUEUE } from "./notifications.constants";
import { NotificationsProcessor } from "./notifications.processor";
import { NotificationsService } from "./notifications.service";

/**
 * Queued SMS and email. Channels come from .env:
 * SMS → SMS_PROVIDER (termii | emisri | console) with optional fallback; email → SMTP (EMAIL_*) or the console.
 */
@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })],
  providers: [
    NotificationsService,
    NotificationsProcessor,
    { provide: SmsChannel, inject: [ConfigService], useFactory: createSmsChannel },
    { provide: EmailChannel, inject: [ConfigService], useFactory: createEmailChannel },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
