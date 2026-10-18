import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";
import { AppException } from "../../common/exceptions/app.exception";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import type { NotificationDto, PreferencesDto } from "./dto/inbox.dto";

/** What a new account starts with. Saved choices are merged over these. */
export const DEFAULT_PREFERENCES: PreferencesDto = {
  orderUpdates: true,
  messages: true,
  offers: false,
  personalised: true,
  analytics: true,
};

export type NotificationType = "order" | "payment" | "seller" | "message" | "withdrawal" | "account";

export interface NewNotification {
  type: NotificationType;
  title: string;
  body: string;
  /** Same path on the website and in the app, e.g. "/orders/92287157". */
  href?: string;
}

/** Which setting turns the phone push for a type on or off (types not listed always push). */
const PUSH_SETTING: Partial<Record<NotificationType, keyof PreferencesDto>> = {
  order: "orderUpdates",
  payment: "orderUpdates",
  withdrawal: "orderUpdates",
  message: "messages",
};

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

const toDto = (n: { id: string; type: string; title: string; body: string; href: string | null; readAt: Date | null; createdAt: Date }): NotificationDto => ({
  id: n.id,
  type: n.type,
  title: n.title,
  body: n.body,
  href: n.href,
  read: !!n.readAt,
  createdAt: n.createdAt,
});

/**
 * The notifications list (website bell / app Notifications screen), phone push tokens and the person's
 * notification settings. Other modules call notify(); it never fails the request that triggered it.
 */
@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: NotificationsService,
  ) {}

  /** Adds to the person's notifications (unless inApp is false) and pushes to their phones if their settings allow. */
  async notify(userId: string | null | undefined, n: NewNotification, opts: { inApp?: boolean } = {}) {
    if (!userId) return;
    try {
      if (opts.inApp !== false) await this.prisma.notification.create({ data: { userId, type: n.type, title: n.title, body: n.body, href: n.href } });
      const setting = PUSH_SETTING[n.type];
      if (setting && !(await this.preferences(userId))[setting]) return;
      const tokens = await this.prisma.pushToken.findMany({ where: { userId }, select: { token: true } });
      if (tokens.length) await this.queue.push({ tokens: tokens.map((t) => t.token), title: n.title, body: n.body, data: n.href ? { href: n.href } : undefined });
    } catch (e) {
      this.logger.warn(`notify ${userId}: ${(e as Error).message}`);
    }
  }

  async list(userId: string, before?: string, limit = 30): Promise<{ items: NotificationDto[]; unread: number; hasMore: boolean }> {
    const rows = await this.prisma.notification.findMany({
      where: { userId, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });
    return { items: rows.slice(0, limit).map(toDto), unread: (await this.unread(userId)).unread, hasMore: rows.length > limit };
  }

  async unread(userId: string) {
    return { unread: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
  }

  /** Marks the given notifications (or all of them) as read. */
  async markRead(userId: string, ids?: string[]) {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
    return this.unread(userId);
  }

  /** Saves this phone's Expo push token for the signed-in person (a token moves with whoever signs in on the phone). */
  async addPushToken(userId: string, token: string, platform?: string) {
    if (!EXPO_TOKEN.test(token)) throw new AppException(HttpStatus.BAD_REQUEST, "INVALID_PUSH_TOKEN", "That isn't an Expo push token.");
    await this.prisma.pushToken.upsert({
      where: { token },
      create: { token, userId, platform },
      update: { userId, platform, lastSeenAt: new Date() },
    });
  }

  async removePushToken(userId: string, token: string) {
    await this.prisma.pushToken.deleteMany({ where: { token, userId } });
  }

  async preferences(userId: string): Promise<PreferencesDto> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } });
    const saved = (u?.preferences && typeof u.preferences === "object" ? u.preferences : {}) as Partial<PreferencesDto>;
    const out = { ...DEFAULT_PREFERENCES };
    for (const k of Object.keys(DEFAULT_PREFERENCES) as (keyof PreferencesDto)[]) if (typeof saved[k] === "boolean") out[k] = saved[k];
    return out;
  }

  async updatePreferences(userId: string, patch: Partial<PreferencesDto>): Promise<PreferencesDto> {
    const next = { ...(await this.preferences(userId)) };
    for (const k of Object.keys(DEFAULT_PREFERENCES) as (keyof PreferencesDto)[]) if (typeof patch[k] === "boolean") next[k] = patch[k]!;
    await this.prisma.user.update({ where: { id: userId }, data: { preferences: next as unknown as Prisma.InputJsonValue } });
    return next;
  }
}
