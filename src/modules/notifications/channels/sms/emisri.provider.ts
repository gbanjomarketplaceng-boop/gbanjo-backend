import { type SmsProvider, SmsProviderError, postJson, toInternational } from "./sms-provider";

export interface EmisriSettings {
  apiKey: string;
  senderId: string;
  /** https://api.emisri.com/v1 */
  baseUrl: string;
  /** Sent as options.excludeDnd (bypass Do-Not-Disturb restrictions for this message). */
  excludeDnd: boolean;
}

/** Emisri — POST {base}/sms/send with the X-Emisri-Api-Key header. Docs: https://docs.emisri.com/docs/services/sms/send-sms */
export class EmisriSmsProvider implements SmsProvider {
  readonly name = "emisri";

  constructor(private readonly settings: EmisriSettings) {}

  async send(to: string, message: string) {
    const { apiKey, senderId, baseUrl, excludeDnd } = this.settings;
    const { status, data } = await postJson(
      this.name,
      `${baseUrl.replace(/\/+$/, "")}/sms/send`,
      { sender: senderId, text: message, destination: [toInternational(to)], campaignName: "gbanjo-otp", options: { excludeDnd } },
      { "X-Emisri-Api-Key": apiKey },
    );
    // Success looks like { success: true, data: { campaignId, summary: { validDestination, invalidDestination } } }.
    const body = data as { success?: boolean; message?: string; error?: { message?: string } | string; data?: { campaignId?: string; summary?: { validDestination?: number } } };
    if (status >= 200 && status < 300 && body.success) {
      if (body.data?.summary && !body.data.summary.validDestination) throw new SmsProviderError(this.name, "the phone number was rejected", status, false);
      return { messageId: body.data?.campaignId };
    }
    const reason = body.message ?? (typeof body.error === "string" ? body.error : body.error?.message) ?? `HTTP ${status}`;
    throw new SmsProviderError(this.name, reason, status, status >= 500 || status === 429);
  }
}
