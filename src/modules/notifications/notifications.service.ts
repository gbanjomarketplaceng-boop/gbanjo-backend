import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { ContactMessageJob, MessageJob, NOTIFICATIONS_QUEUE, NotificationJob, PasswordChangedJob, SendOtpJob } from "./notifications.constants";

/** Puts notifications on the BullMQ queue so requests never wait on SMS/email providers. */
@Injectable()
export class NotificationsService {
  constructor(@InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue) {}

  sendOtp(job: SendOtpJob) {
    // Codes go stale quickly, so don't keep retrying for long.
    return this.queue.add(NotificationJob.SendOtp, job, { attempts: 3, backoff: { type: "fixed", delay: 2000 } });
  }

  passwordChanged(job: PasswordChangedJob) {
    return this.queue.add(NotificationJob.PasswordChanged, job);
  }

  /** Emails the support inbox (reply goes to the customer) and sends the customer a confirmation. */
  contactMessage(job: ContactMessageJob) {
    return this.queue.add(NotificationJob.ContactMessage, job, { attempts: 5, backoff: { type: "exponential", delay: 5000 } });
  }

  /** Order updates and receipts. Never throws: a notification problem must not fail the request. */
  message(job: MessageJob) {
    const opts = { attempts: 5, backoff: { type: "exponential" as const, delay: 5000 } };
    // Separate jobs so a failing SMS gateway never makes the email go out twice (and vice versa).
    const jobs: MessageJob[] = [];
    if (job.email) jobs.push({ email: job.email, subject: job.subject, text: job.text });
    if (job.phone && job.sms) jobs.push({ phone: job.phone, subject: job.subject, text: "", sms: job.sms });
    return Promise.all(jobs.map((j) => this.queue.add(NotificationJob.Message, j, opts))).catch(() => null);
  }
}
