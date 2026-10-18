import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { EmailChannel, SmsChannel } from "./channels/channel.interfaces";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.validation";
import { PrismaService } from "../../prisma/prisma.service";
import { ContactMessageJob, MessageJob, PushJob, NOTIFICATIONS_QUEUE, NotificationJob, PasswordChangedJob, SendOtpJob } from "./notifications.constants";

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
    private readonly prisma: PrismaService,
  ) {
    super();
    this.supportEmail = config.get("SUPPORT_EMAIL", { infer: true });
    this.expoToken = config.get("EXPO_ACCESS_TOKEN", { infer: true });
  }

  private readonly expoToken?: string;

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
      case NotificationJob.Push:
        return this.push(job.data as PushJob);
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

  /** Sends through Expo's push service; forgets tokens for apps that were uninstalled. https://docs.expo.dev/push-notifications/sending-notifications/ */
  private async push({ tokens, title, body, data }: PushJob) {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(this.expoToken ? { Authorization: `Bearer ${this.expoToken}` } : {}) },
      body: JSON.stringify(tokens.map((to) => ({ to, title, body, data, sound: "default" }))),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Expo push failed: HTTP ${res.status}`);
    const json = (await res.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null;
    const gone = (json?.data ?? []).map((t, i) => (t.status === "error" && t.details?.error === "DeviceNotRegistered" ? tokens[i] : null)).filter((t): t is string => !!t);
    if (gone.length) await this.prisma.pushToken.deleteMany({ where: { token: { in: gone } } });
  }

  private async passwordChanged({ email, firstName }: PasswordChangedJob) {
    await this.email.send(
      email,
      "Your Gbanjo password was changed",
      `Hi ${firstName},\n\nYour password was just changed and you were signed out on your other devices. If this wasn't you, reset your password now and contact support.`,
    );
  }
}
