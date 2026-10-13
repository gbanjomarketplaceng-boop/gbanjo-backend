import { Injectable, Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import { EmailChannel } from "../channel.interfaces";

export interface SmtpSettings {
  /** A nodemailer well-known service name such as "gmail" (sets host/port for you). */
  service?: string;
  host?: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

/** Sends email through an SMTP account (EMAIL_* settings in .env). */
@Injectable()
export class SmtpEmailChannel extends EmailChannel {
  private readonly logger = new Logger("Email");
  private readonly transport: Transporter;

  constructor(private readonly settings: SmtpSettings) {
    super();
    this.transport = createTransport({
      // EMAIL_HOST wins over EMAIL_SERVICE, so an unrecognised service name can't send mail to the wrong server.
      ...(settings.host ? { host: settings.host, port: settings.port, secure: settings.secure } : { service: settings.service }),
      auth: { user: settings.user, pass: settings.password },
    });
  }

  async send(to: string, subject: string, text: string, opts?: { replyTo?: string }) {
    await this.transport.sendMail({ from: this.settings.from, to, subject, text, ...(opts?.replyTo ? { replyTo: opts.replyTo } : {}) });
    this.logger.log(`Sent "${subject}" to ${to}`);
  }
}
