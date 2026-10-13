import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../../../config/env.validation";
import type { EmailChannel } from "../channel.interfaces";
import { ConsoleEmailChannel } from "./console-email.channel";
import { SmtpEmailChannel } from "./smtp-email.channel";

/** Real SMTP when the EMAIL_* settings are present, otherwise emails are printed to the log. */
export function createEmailChannel(config: ConfigService<Env, true>): EmailChannel {
  const get = <K extends keyof Env>(k: K) => config.get(k, { infer: true });
  const user = get("EMAIL_HOST_USER");
  const password = get("EMAIL_HOST_PASSWORD");
  const service = get("EMAIL_SERVICE");
  const host = get("EMAIL_HOST");
  if (!user || !password || (!service && !host)) {
    new Logger("Email").warn("EMAIL_* settings missing: emails are printed to this log instead of being sent.");
    return new ConsoleEmailChannel();
  }
  const port = get("EMAIL_PORT");
  return new SmtpEmailChannel({ service, host, port, secure: get("EMAIL_SECURE") ?? port === 465, user, password, from: get("EMAIL_FROM") ?? `Gbanjo <${user}>` });
}
