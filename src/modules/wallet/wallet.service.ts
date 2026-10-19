import { HttpStatus, Injectable } from "@nestjs/common";
import type { Prisma, WalletTxType } from "../../generated/prisma/client";
import { AppException } from "../../common/exceptions/app.exception";
import { PrismaService } from "../../prisma/prisma.service";

export interface WalletView {
  /** Two decimal places, as a string so no precision is lost, e.g. "0.00". */
  balance: string;
  /** Seller earnings still on hold (they move into the balance on their payout date). */
  pending: string;
  currency: string;
  updatedAt: Date;
}

export interface WalletTransactionView {
  id: string;
  type: "top-up" | "order-payment" | "refund" | "sale" | "withdrawal" | "adjustment";
  status: "pending" | "completed";
  /** Signed: positive is money in. */
  amount: number;
  description: string;
  reference: string;
  orderId: string | null;
  availableAt: Date | null;
  createdAt: Date;
}

type Tx = Prisma.TransactionClient;

export interface LedgerEntry {
  userId: string;
  /** Always positive; credit adds it, debit takes it away. */
  amount: number;
  type: WalletTxType;
  /** Idempotency key: the same reference is only ever applied once. */
  reference: string;
  description: string;
  orderId?: string;
  paymentId?: string;
  /** Hold the money until this time (seller earnings). */
  availableAt?: Date;
}

const TYPE: Record<WalletTxType, WalletTransactionView["type"]> = {
  TOP_UP: "top-up",
  ORDER_PAYMENT: "order-payment",
  REFUND: "refund",
  SALE: "sale",
  WITHDRAWAL: "withdrawal",
  ADJUSTMENT: "adjustment",
};

/**
 * Wallet balance plus a ledger of every change. Every change goes through credit/debit so the balance
 * always equals the sum of completed ledger rows, and a reference can never be applied twice.
 */
@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  private walletFor(tx: Tx | PrismaService, userId: string) {
    return tx.wallet.upsert({ where: { userId }, create: { userId }, update: {}, select: { id: true } });
  }

  /** The user's wallet. Every account gets one at sign-up; this also creates it for any account that predates wallets. */
  async forUser(userId: string): Promise<WalletView> {
    await this.settle(userId);
    const wallet = await this.prisma.wallet.upsert({ where: { userId }, create: { userId }, update: {} });
    const pending = await this.prisma.walletTransaction.aggregate({ where: { walletId: wallet.id, status: "PENDING" }, _sum: { amount: true } });
    return {
      balance: wallet.balance.toFixed(2),
      pending: Number(pending._sum.amount ?? 0).toFixed(2),
      currency: wallet.currency,
      updatedAt: wallet.updatedAt,
    };
  }

  async transactions(userId: string, limit = 50): Promise<WalletTransactionView[]> {
    const wallet = await this.walletFor(this.prisma, userId);
    const rows = await this.prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.map((r) => ({
      id: r.id,
      type: TYPE[r.type],
      status: r.status === "PENDING" ? "pending" : "completed",
      amount: Number(r.amount),
      description: r.description,
      reference: r.reference,
      orderId: r.orderId,
      availableAt: r.availableAt,
      createdAt: r.createdAt,
    }));
  }

  /** Adds money (or holds it as pending when `availableAt` is in the future). Returns false if the reference was already applied. */
  async credit(tx: Tx, e: LedgerEntry): Promise<boolean> {
    const wallet = await this.walletFor(tx, e.userId);
    const pending = !!e.availableAt && e.availableAt.getTime() > Date.now();
    const { count } = await tx.walletTransaction.createMany({
      data: [
        {
          walletId: wallet.id,
          type: e.type,
          status: pending ? "PENDING" : "COMPLETED",
          amount: e.amount,
          reference: e.reference,
          description: e.description,
          orderId: e.orderId,
          paymentId: e.paymentId,
          availableAt: e.availableAt,
        },
      ],
      skipDuplicates: true,
    });
    if (count && !pending) await tx.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: e.amount } } });
    return count > 0;
  }

  /** Takes money out; fails with INSUFFICIENT_FUNDS (and changes nothing) if the balance is too low. */
  async debit(tx: Tx, e: LedgerEntry): Promise<void> {
    const wallet = await this.walletFor(tx, e.userId);
    const { count } = await tx.wallet.updateMany({ where: { id: wallet.id, balance: { gte: e.amount } }, data: { balance: { decrement: e.amount } } });
    if (!count) throw new AppException(HttpStatus.PAYMENT_REQUIRED, "INSUFFICIENT_FUNDS", "There isn't enough money in your wallet. Add money or pay by card.");
    await tx.walletTransaction.create({
      data: { walletId: wallet.id, type: e.type, amount: -e.amount, reference: e.reference, description: e.description, orderId: e.orderId, paymentId: e.paymentId },
    });
  }

  /** Moves held earnings whose payout date has passed into the balance. Safe to call any number of times. */
  async settle(userId?: string): Promise<number> {
    const due = await this.prisma.walletTransaction.findMany({
      where: { status: "PENDING", availableAt: { lte: new Date() }, ...(userId ? { wallet: { userId } } : {}) },
      select: { id: true, walletId: true, amount: true },
      take: 500,
    });
    let moved = 0;
    for (const t of due) {
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.walletTransaction.updateMany({ where: { id: t.id, status: "PENDING" }, data: { status: "COMPLETED" } });
        if (count) {
          await tx.wallet.update({ where: { id: t.walletId }, data: { balance: { increment: t.amount } } });
          moved++;
        }
      });
    }
    return moved;
  }
}
