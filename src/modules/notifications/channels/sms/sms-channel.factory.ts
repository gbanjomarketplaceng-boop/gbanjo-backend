import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../../../config/env.validation";
import type { SmsChannel } from "../channel.interfaces";
import { ConsoleSmsChannel } from "./console-sms.channel";
import { EmisriSmsProvider } from "./emisri.provider";
import { GatewaySmsChannel } from "./gateway-sms.channel";
import type { SmsProvider } from "./sms-provider";
import { TermiiSmsProvider } from "./termii.provider";

/**
 * SMS_PROVIDER picks the gateway (termii | emisri | console). With SMS_FALLBACK_ENABLED the other
 * gateway is tried when the first one fails. A gateway is only used when its API key and sender ID are set.
 */
export function createSmsChannel(config: ConfigService<Env, true>): SmsChannel {
  const get = <K extends keyof Env>(k: K) => config.get(k, { infer: true });
  const logger = new Logger("SMS");

  const available: Record<"termii" | "emisri", SmsProvider | undefined> = {
    termii:
      get("TERMII_API_KEY") && get("TERMII_SENDER_ID")
        ? new TermiiSmsProvider({ apiKey: get("TERMII_API_KEY")!, senderId: get("TERMII_SENDER_ID")!, baseUrl: get("TERMII_BASE_URL"), channel: get("TERMII_CHANNEL") })
        : undefined,
    emisri:
      get("EMISRI_API_KEY") && get("EMISRI_SENDER_ID")
        ? new EmisriSmsProvider({ apiKey: get("EMISRI_API_KEY")!, senderId: get("EMISRI_SENDER_ID")!, baseUrl: get("EMISRI_BASE_URL"), excludeDnd: get("EMISRI_EXCLUDE_DND") })
        : undefined,
  };

  const choice = get("SMS_PROVIDER");
  if (choice === "console") {
    logger.warn("SMS_PROVIDER=console: text messages are printed to this log instead of being sent.");
    return new ConsoleSmsChannel();
  }
  const other = choice === "termii" ? "emisri" : "termii";
  const order = [available[choice], get("SMS_FALLBACK_ENABLED") ? available[other] : undefined].filter((p): p is SmsProvider => !!p);
  if (!order.length) {
    logger.warn(`SMS_PROVIDER=${choice} but its API key / sender ID is missing: text messages are printed to this log instead.`);
    return new ConsoleSmsChannel();
  }
  if (!available[choice]) logger.warn(`${choice} isn't set up (API key / sender ID missing); using ${other} only.`);
  logger.log(`Text messages go through ${order.map((p) => p.name).join(" → then ")}.`);
  return new GatewaySmsChannel(order);
}
