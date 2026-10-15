import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { EmailChannel, SmsChannel } from "./channels/channel.interfaces";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.validation";
import { ContactMessageJob, MessageJob, NOTIFICATIONS_QUEUE, NotificationJob, PasswordChangedJob, SendOtpJob } from "./notifications.constants";

const PURPOSE_TEXT: Record<SendOtpJob["purpose"], string> = {
  signup: "verify your phone number",
  password_reset: "reset your password",
};

/** BullMQ worker for the notifications queue. */
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  private readonly supportEmail: string;

  constructor(
    private readonly sms: SmsChannel,
    private readonly email: EmailChannel,
    config: ConfigService<Env, true>,
  ) {
    super();
    this.supportEmail = config.get("SUPPORT_EMAIL", { infer: true });
  }

  async process(job: Job) {
    switch (job.name) {
      case NotificationJob.SendOtp:
        return this.sendOtp(job.data as SendOtpJob);
      case NotificationJob.PasswordChanged:
        return this.passwordChanged(job.data as PasswordChangedJob);
      case NotificationJob.ContactMessage:
        return this.contactMessage(job.data as ContactMessageJob);
      case NotificationJob.Message:
        return this.message(job.data as MessageJob);
      default:
        this.logger.warn(`Unknown job "${job.name}"`);
    }
  }

  private async sendOtp({ channel, to, code, purpose, firstName, expiresInMinutes }: SendOtpJob) {
    const text = `Your Gbanjo code is ${code}. Use it to ${PURPOSE_TEXT[purpose]}. It expires in ${expiresInMinutes} minutes. Don't share it with anyone.`;
    if (channel === "sms") await this.sms.send(to, text);
    else await this.email.send(to, "Your Gbanjo code", `Hi ${firstName ?? "there"},\n\n${text}`);
  }

  private async contactMessage(m: ContactMessageJob) {
    await this.email.send(
      this.supportEmail,
      `[Contact · ${m.topic}] ${m.subject}`,
      [
        `From: ${m.name} <${m.email}>`,
        `Topic: ${m.topic}`,
        ...(m.orderRef ? [`Order reference: ${m.orderRef}`] : []),
        `Message id: ${m.id}`,
        "",
        m.message,
      ].join("\n"),
      { replyTo: m.email },
    );
    await this.email.send(
      m.email,
      "We got your message — Gbanjo support",
      `Hi ${m.name},\n\nThanks for contacting Gbanjo. We've received your message "${m.subject}" and will reply to this email address soon.\n\nYour message:\n${m.message}\n\n— The Gbanjo team`,
    );
  }

  private async message({ email, phone, subject, text, sms }: MessageJob) {
    if (email) await this.email.send(email, subject, text);
    if (phone && sms) await this.sms.send(phone, sms);
  }

  private async passwordChanged({ email, firstName }: PasswordChangedJob) {
    await this.email.send(
      email,
      "Your Gbanjo password was changed",
      `Hi ${firstName},\n\nYour password was just changed and you were signed out on your other devices. If this wasn't you, reset your password now and contact support.`,
    );
  }
}
