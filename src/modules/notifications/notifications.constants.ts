export const NOTIFICATIONS_QUEUE = "notifications";

export const NotificationJob = {
  SendOtp: "send-otp",
  PasswordChanged: "password-changed",
  ContactMessage: "contact-message",
  Message: "message",
  Push: "push",
} as const;

export type OtpPurpose = "signup" | "password_reset";

export interface SendOtpJob {
  channel: "sms" | "email";
  to: string;
  code: string;
  purpose: OtpPurpose;
  firstName?: string;
  expiresInMinutes: number;
}

export interface PasswordChangedJob {
  email: string;
  phone: string | null;
  firstName: string;
}

export interface ContactMessageJob {
  id: string;
  name: string;
  email: string;
  topic: string;
  orderRef?: string | null;
  subject: string;
  message: string;
}

/** A plain email and/or text (order updates, receipts). Either address may be missing. */
export interface MessageJob {
  email?: string | null;
  phone?: string | null;
  subject: string;
  /** Email body. */
  text: string;
  /** Text-message body (keep it short); no SMS is sent without it. */
  sms?: string;
}

/** A phone push through Expo's push service. */
export interface PushJob {
  tokens: string[];
  title: string;
  body: string;
  /** Sent to the app with the push, e.g. { href: "/orders/123" }. */
  data?: Record<string, string>;
}
