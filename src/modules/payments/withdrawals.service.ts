import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import type { Withdrawal } from "../../generated/prisma/client";
import { AppException } from "../../common/exceptions/app.exception";
import type { Env } from "../../config/env.validation";
import { PrismaService } from "../../prisma/prisma.service";
import { InboxService } from "../inbox/inbox.service";
import { NotificationsService } from "../notifications/notifications.service";
import { WalletService } from "../wallet/wallet.service";
import type { BankAccountDto, BankDto, SaveBankAccountDto, WithdrawalDto } from "./dto/withdrawals.dto";
import { PaymentsService } from "./payments.service";
import type { Bank } from "./providers/payment-provider";

const naira = (n: number) => `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const mask = (n: string) => `******${n.slice(-4)}`;

export const toWithdrawalDto = (w: Withdrawal): WithdrawalDto => ({
  id: w.id,
  reference: w.reference,
  amount: Number(w.amount),
  status: w.status.toLowerCase(),
  bankName: w.bankName,
  accountNumber: mask(w.accountNumber),
  accountName: w.accountName,
  failureReason: w.failureReason,
  completedAt: w.completedAt,
  createdAt: w.createdAt,
});

/**
 * Sending wallet money to the person's bank with Flutterwave transfers. The wallet is debited first; if the
 * transfer fails the money goes straight back. The final result comes from Flutterwave (reply, webhook, or a
 * check every few minutes) — never from the client.
 */
@Injectable()
export class WithdrawalsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WithdrawalsService.name);
  private bankCache?: { at: number; banks: Bank[] };
  private sweeper?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly wallets: WalletService,
    private readonly inbox: InboxService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService<Env, true>,
  ) {
    payments.onTransferEvent((d) => this.onTransferEvent(d));
  }

  onModuleInit() {
    if (this.config.get("NODE_ENV", { infer: true }) === "test") return;
    this.sweeper = setInterval(() => void this.sweep().catch((e) => this.logger.warn(`sweep: ${(e as Error).message}`)), 5 * 60_000);
    this.sweeper.unref();
  }

  onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  async banks(): Promise<BankDto[]> {
    if (this.bankCache && Date.now() - this.bankCache.at < 12 * 3600_000) return this.bankCache.banks;
    const banks = await this.payments.transferProvider().banks();
    this.bankCache = { at: Date.now(), banks };
    return banks;
  }

  async bankAccount(userId: string): Promise<BankAccountDto | null> {
    const a = await this.prisma.bankAccount.findUnique({ where: { userId } });
    return a ? { bankCode: a.bankCode, bankName: a.bankName, accountNumber: a.accountNumber, accountName: a.accountName } : null;
  }

  /** Checks the account with the bank (to get the holder's name) and saves it. */
  async saveBankAccount(userId: string, dto: SaveBankAccountDto): Promise<BankAccountDto> {
    const bank = (await this.banks()).find((b) => b.code === dto.bankCode);
    if (!bank) throw new AppException(HttpStatus.BAD_REQUEST, "UNKNOWN_BANK", "Choose your bank from the list.", { fields: { bankCode: "Choose your bank from the list." } });
    const name = await this.payments.transferProvider().resolveAccount(bank.code, dto.accountNumber);
    if (!name)
      throw new AppException(HttpStatus.BAD_REQUEST, "ACCOUNT_NOT_FOUND", "We couldn't find that account. Check the number and bank.", {
        fields: { accountNumber: "We couldn't find that account. Check the number and bank." },
      });
    const data = { bankCode: bank.code, bankName: bank.name, accountNumber: dto.accountNumber, accountName: name };
    await this.prisma.bankAccount.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    return data;
  }

  async list(userId: string): Promise<WithdrawalDto[]> {
    const rows = await this.prisma.withdrawal.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 });
    return rows.map(toWithdrawalDto);
  }

  async withdraw(userId: string, amount: number): Promise<WithdrawalDto> {
    const min = this.config.get("WITHDRAWAL_MIN", { infer: true });
    if (amount < min) throw new AppException(HttpStatus.BAD_REQUEST, "AMOUNT_TOO_SMALL", `The smallest withdrawal is ${naira(min)}.`, { fields: { amount: `At least ${naira(min)}` } });
    const account = await this.prisma.bankAccount.findUnique({ where: { userId } });
    if (!account) throw new AppException(HttpStatus.BAD_REQUEST, "BANK_ACCOUNT_REQUIRED", "Add your bank account first.");
    const provider = this.payments.transferProvider();
    await this.wallets.settle(userId);

    const reference = `WDR-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const w = await this.prisma
      .$transaction(async (tx) => {
      const row = await tx.withdrawal.create({
        data: {
          userId,
          reference,
          amount,
          bankCode: account.bankCode,
          bankName: account.bankName,
          accountNumber: account.accountNumber,
          accountName: account.accountName,
          provider: provider.name,
        },
      });
      await this.wallets.debit(tx, { userId, amount, type: "WITHDRAWAL", reference: `withdrawal:${reference}`, description: `Withdrawal to ${account.bankName} ${mask(account.accountNumber)}` });
      return row;
      })
      .catch(async (e: unknown) => {
        if ((e as AppException).code !== "INSUFFICIENT_FUNDS") throw e;
        const balance = Number((await this.wallets.forUser(userId)).balance);
        throw new AppException(HttpStatus.BAD_REQUEST, "INSUFFICIENT_FUNDS", `You can withdraw up to ${naira(balance)}.`, { fields: { amount: `You can withdraw up to ${naira(balance)}` } });
      });

    try {
      const r = await provider.transfer({ reference, bankCode: account.bankCode, accountNumber: account.accountNumber, amount, narration: "Gbanjo withdrawal" });
      if (r.status === "failed") await this.fail(w, r.message || "The bank transfer failed");
      else if (r.status === "successful") await this.succeed(w, r.transferId);
      else await this.prisma.withdrawal.update({ where: { id: w.id }, data: { status: "PROCESSING", providerTransferId: r.transferId || null } });
    } catch (e) {
      // We don't know whether Flutterwave queued it: keep the money out and wait for the webhook / an admin.
      this.logger.error(`withdrawal ${reference}: ${(e as Error).message}`);
      await this.prisma.withdrawal.update({ where: { id: w.id }, data: { status: "PROCESSING", failureReason: "Waiting for confirmation from the bank" } });
    }
    return toWithdrawalDto(await this.prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } }));
  }

  private async succeed(w: Withdrawal, transferId?: string) {
    const { count } = await this.prisma.withdrawal.updateMany({
      where: { id: w.id, status: { in: ["PENDING", "PROCESSING"] } },
      data: { status: "SUCCESSFUL", completedAt: new Date(), failureReason: null, ...(transferId ? { providerTransferId: transferId } : {}) },
    });
    if (!count) return;
    await this.tell(w, true);
  }

  /** Marks it failed and puts the money back in the wallet (once). */
  private async fail(w: Withdrawal, reason: string) {
    const done = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.withdrawal.updateMany({ where: { id: w.id, status: { in: ["PENDING", "PROCESSING"] } }, data: { status: "FAILED", failureReason: reason, completedAt: new Date() } });
      if (!count) return false;
      await this.wallets.credit(tx, { userId: w.userId, amount: Number(w.amount), type: "WITHDRAWAL", reference: `withdrawal-reversal:${w.reference}`, description: `Withdrawal ${w.reference} failed — money returned` });
      return true;
    });
    if (done) await this.tell(w, false, reason);
  }

  private async tell(w: Withdrawal, ok: boolean, reason?: string) {
    const amount = naira(Number(w.amount));
    await this.inbox.notify(w.userId, {
      type: "withdrawal",
      title: ok ? `${amount} sent to your bank` : "Withdrawal didn't go through",
      body: ok ? `${w.bankName} ${mask(w.accountNumber)} · ${w.reference}` : `${reason ?? "The transfer failed"}. The money is back in your wallet.`,
      href: "/profile/wallet/history",
    });
    const user = await this.prisma.user.findUnique({ where: { id: w.userId }, select: { email: true, firstName: true } });
    if (user)
      await this.notifications.message({
        email: user.email,
        subject: ok ? `${amount} is on its way to your bank` : "Your Gbanjo withdrawal didn't go through",
        text: ok
          ? `Hi ${user.firstName},\n\nWe've sent ${amount} to ${w.accountName}, ${w.bankName} ${mask(w.accountNumber)}.\nReference: ${w.reference}\n\n— The Gbanjo team`
          : `Hi ${user.firstName},\n\nYour withdrawal of ${amount} (${w.reference}) didn't go through: ${reason}. The money is back in your Gbanjo wallet.\n\n— The Gbanjo team`,
      });
  }

  /** Flutterwave webhook: look the transfer up ourselves before believing it. */
  private async onTransferEvent(d: { id?: string; reference?: string }) {
    const w = d.reference ? await this.prisma.withdrawal.findUnique({ where: { reference: d.reference } }) : null;
    if (!w || (w.status !== "PENDING" && w.status !== "PROCESSING")) return;
    const transferId = d.id ?? w.providerTransferId;
    if (!transferId) return;
    await this.apply(w, transferId);
  }

  private async apply(w: Withdrawal, transferId: string) {
    const provider = this.payments.providerNamed(w.provider);
    if (!provider) return;
    const r = await provider.transferStatus(transferId);
    if (r.status === "successful") await this.succeed(w, transferId);
    else if (r.status === "failed") await this.fail(w, r.message || "The bank transfer failed");
    else if (!w.providerTransferId) await this.prisma.withdrawal.update({ where: { id: w.id }, data: { providerTransferId: transferId } });
  }

  async sweep() {
    const rows = await this.prisma.withdrawal.findMany({
      where: { status: "PROCESSING", providerTransferId: { not: null }, updatedAt: { lte: new Date(Date.now() - 2 * 60_000) } },
      take: 50,
    });
    for (const w of rows) await this.apply(w, w.providerTransferId!).catch((e) => this.logger.warn(`check ${w.reference}: ${(e as Error).message}`));
  }
}
