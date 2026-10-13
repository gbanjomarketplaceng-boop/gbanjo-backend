import { Injectable, Logger } from "@nestjs/common";
import { SmsChannel } from "../channel.interfaces";

/** Development channel: prints the SMS to the server log instead of sending it. */
@Injectable()
export class ConsoleSmsChannel extends SmsChannel {
  private readonly logger = new Logger("SMS");

  async send(to: string, message: string) {
    this.logger.log(`→ ${to}: ${message}`);
  }
}
