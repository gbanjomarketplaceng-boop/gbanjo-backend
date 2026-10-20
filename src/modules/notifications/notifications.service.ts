import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Job, JobsOptions, Queue } from "bullmq";
import { KvService } from "../../redis/kv.service";
import { NotificationsProcessor } from "./notifications.processor";
import { ContactMessageJob, MessageJob, PushJob, NOTIFICATIONS_QUEUE, NotificationJob, PasswordChangedJob, SendOtpJob } from "./notifications.constants";

/** How long to wait for the queue before sending directly. */
const QUEUE_TIMEOUT_MS = 3000;

/**
 * Puts notifications on the BullMQ queue so requests never wait on SMS/email providers.
 * If the queue can't be reached (Redis down or over its limit), the notification is sent directly
 * from this server in the background instead (with a few retries), so codes and receipts still go out.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger("Notifications");

  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
    private readonly processor: NotificationsProcessor,
    private readonly kv: KvService,
  ) {}

  private async enqueue(name: (typeof NotificationJob)[keyof typeof NotificationJob], data: unknown, opts?: JobsOptions): Promise<unknown> {
    if (this.kv.redisUp) {
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          this.queue.add(name, data, opts),
          new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("queue timed out")), QUEUE_TIMEOUT_MS))),
        ]);
      } catch (e) {
        this.kv.markDown(e);
      } finally {
        clearTimeout(timer);
      }
    }
    void this.sendNow(name, data, opts?.attempts ?? 3);
    return null;
  }

  /** Runs the job here (no queue), retrying a couple of times on provider errors. */
  private async sendNow(name: (typeof NotificationJob)[keyof typeof NotificationJob], data: unknown, attempts: number) {
    for (let i = 1; i <= attempts; i++) {
      try {
        await this.processor.process({ name, data } as Job);
        return;
      } catch (e) {
        if (i === attempts) this.logger.error(`Couldn't send ${name} without the queue: ${(e as Error).message}`);
        else await new Promise((r) => setTimeout(r, 2000 * i));
      }
    }
  }

  sendOtp(job: SendOtpJob) {
    // Codes go stale quickly, so don't keep retrying for long.
    return this.enqueue(NotificationJob.SendOtp, job, { attempts: 3, backoff: { type: "fixed", delay: 2000 } });
  }

  passwordChanged(job: PasswordChangedJob) {
    return this.enqueue(NotificationJob.PasswordChanged, job);
  }

  /** Emails the support inbox (reply goes to the customer) and sends the customer a confirmation. */
  contactMessage(job: ContactMessageJob) {
    return this.enqueue(NotificationJob.ContactMessage, job, { attempts: 5, backoff: { type: "exponential", delay: 5000 } });
  }

  /** Order updates and receipts. Never throws: a notification problem must not fail the request. */
  message(job: MessageJob) {
    const opts = { attempts: 5, backoff: { type: "exponential" as const, delay: 5000 } };
    // Separate jobs so a failing SMS gateway never makes the email go out twice (and vice versa).
    const jobs: MessageJob[] = [];
    if (job.email) jobs.push({ email: job.email, subject: job.subject, text: job.text });
    if (job.phone && job.sms) jobs.push({ phone: job.phone, subject: job.subject, text: "", sms: job.sms });
    return Promise.all(jobs.map((j) => this.enqueue(NotificationJob.Message, j, opts))).catch(() => null);
  }

  /** Phone push (Expo). Never throws. */
  push(job: PushJob) {
    if (!job.tokens.length) return Promise.resolve(null);
    return this.enqueue(NotificationJob.Push, job, { attempts: 3, backoff: { type: "exponential", delay: 5000 } }).catch(() => null);
  }
}
