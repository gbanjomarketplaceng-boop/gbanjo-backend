import { Injectable, Logger } from "@nestjs/common";
import { EmailChannel } from "../channel.interfaces";

/** Development channel: prints the email to the server log instead of sending it. */
@Injectable()
export class ConsoleEmailChannel extends EmailChannel {
  private readonly logger = new Logger("Email");

  async send(to: string, subject: string, text: string, opts?: { replyTo?: string }) {
    this.logger.log(`→ ${to}${opts?.replyTo ? ` (reply-to ${opts.replyTo})` : ""} | ${subject}\n${text}`);
  }
}
