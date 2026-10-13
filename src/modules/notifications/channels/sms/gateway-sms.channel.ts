import { Logger } from "@nestjs/common";
import { SmsChannel } from "../channel.interfaces";
import { type SmsProvider, SmsProviderError, maskForLog } from "./sms-provider";

/**
 * Sends through the primary gateway; if it fails and a fallback is configured, tries the fallback.
 * If every gateway fails the error is thrown, so the notifications queue retries the job later.
 */
export class GatewaySmsChannel extends SmsChannel {
  private readonly logger = new Logger("SMS");

  constructor(private readonly providers: SmsProvider[]) {
    super();
  }

  async send(to: string, message: string) {
    const errors: string[] = [];
    for (const provider of this.providers) {
      try {
        const { messageId } = await provider.send(to, message);
        this.logger.log(`Sent to ${maskForLog(to)} via ${provider.name}${messageId ? ` (${messageId})` : ""}`);
        return;
      } catch (e) {
        const reason = e instanceof SmsProviderError ? e.message : `${provider.name}: ${String(e)}`;
        errors.push(reason);
        this.logger.warn(`Couldn't send to ${maskForLog(to)} via ${provider.name}: ${reason}`);
      }
    }
    throw new Error(`SMS not sent (${errors.join("; ")})`);
  }
}
