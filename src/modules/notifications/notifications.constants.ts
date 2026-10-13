export const NOTIFICATIONS_QUEUE = "notifications";

export const NotificationJob = {
  SendOtp: "send-otp",
  PasswordChanged: "password-changed",
  ContactMessage: "contact-message",
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
