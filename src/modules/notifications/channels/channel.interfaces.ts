/**
 * What the notifications worker sends through. NotificationsModule picks the implementations from .env:
 * SMS → Termii / Emisri (with fallback) or the console; email → SMTP or the console.
 */
export abstract class SmsChannel {
  /** `to` is +234XXXXXXXXXX. Throws if no provider accepted the message (the queue then retries). */
  abstract send(to: string, message: string): Promise<void>;
}

export abstract class EmailChannel {
  /** `replyTo` makes "Reply" in the mail app go to that address (e.g. the customer who wrote in). */
  abstract send(to: string, subject: string, text: string, opts?: { replyTo?: string }): Promise<void>;
}
