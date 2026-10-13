import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

export interface WalletView {
  /** Two decimal places, as a string so no precision is lost, e.g. "0.00". */
  balance: string;
  currency: string;
  updatedAt: Date;
}

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /** The user's wallet. Every account gets one at sign-up; this also creates it for any account that predates wallets. */
  async forUser(userId: string): Promise<WalletView> {
    const wallet = await this.prisma.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
    return { balance: wallet.balance.toFixed(2), currency: wallet.currency, updatedAt: wallet.updatedAt };
  }
}
