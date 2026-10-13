import { type SmsProvider, SmsProviderError, postJson, toInternational } from "./sms-provider";

export interface TermiiSettings {
  apiKey: string;
  senderId: string;
  /** e.g. https://api.ng.termii.com (from your Termii dashboard). */
  baseUrl: string;
  /** "dnd" reaches every number and is meant for OTPs (must be enabled on the account); "generic" skips DND numbers. */
  channel: "dnd" | "generic";
}

/** Termii — POST {base}/api/sms/send. Docs: https://developers.termii.com/messaging-api */
export class TermiiSmsProvider implements SmsProvider {
  readonly name = "termii";

  constructor(private readonly settings: TermiiSettings) {}

  async send(to: string, message: string) {
    const { apiKey, senderId, baseUrl, channel } = this.settings;
    const { status, data } = await postJson(this.name, `${baseUrl.replace(/\/+$/, "")}/api/sms/send`, {
      api_key: apiKey,
      to: toInternational(to),
      from: senderId,
      sms: message,
      type: "plain",
      channel,
    });
    // Success looks like { code: "ok", message_id: "...", message: "Successfully Sent" }.
    if (status >= 200 && status < 300 && data.code === "ok") return { messageId: String(data.message_id ?? data.message_id_str ?? "") || undefined };
    const reason = typeof data.message === "string" ? data.message : `HTTP ${status}`;
    // 401/403 (bad key), 400/422 (bad sender / number) won't get better by retrying.
    throw new SmsProviderError(this.name, reason, status, status >= 500 || status === 429);
  }
}
