import { HttpStatus, Injectable } from "@nestjs/common";
import { AppException } from "../../common/exceptions/app.exception";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ChatEventsService } from "./chat-events.service";
import type { ChatMessageDto, ConversationDto, MessagePageDto } from "./dto/chat.dto";

const userCard = { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } as const;
const INCLUDE = {
  buyer: userCard,
  seller: userCard,
  product: { select: { slug: true, name: true, price: true, location: true, imageUrl: true, status: true } },
  messages: { orderBy: { createdAt: "desc" }, take: 1 },
} satisfies Prisma.ConversationInclude;
type Row = Prisma.ConversationGetPayload<{ include: typeof INCLUDE }>;

const shortName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName ? `${u.lastName[0]}.` : ""}`.trim();

const toMessage = (m: { id: string; conversationId: string; senderId: string; text: string; createdAt: Date }): ChatMessageDto => ({
  id: m.id,
  conversationId: m.conversationId,
  senderId: m.senderId,
  text: m.text,
  createdAt: m.createdAt,
});

/** Buyer ↔ seller chat about a listing. Every change is also pushed live through ChatEventsService. */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: ChatEventsService,
  ) {}

  private view(userId: string, c: Row, unread: number): ConversationDto {
    const role = c.buyerId === userId ? "buyer" : "seller";
    const other = role === "buyer" ? c.seller : c.buyer;
    return {
      id: c.id,
      role,
      other: { id: other.id, name: shortName(other), ...(other.avatarUrl ? { avatar: other.avatarUrl } : {}) },
      product: c.product
        ? { id: c.product.slug, title: c.product.name, price: Number(c.product.price), location: c.product.location, photo: c.product.imageUrl, status: c.product.status.toLowerCase() }
        : null,
      lastMessage: c.messages[0] ? toMessage(c.messages[0]) : null,
      unread,
      lastMessageAt: c.lastMessageAt,
      otherLastReadAt: role === "buyer" ? c.sellerLastReadAt : c.buyerLastReadAt,
    };
  }

  private unreadWhere(userId: string, c: { id: string; buyerId: string; buyerLastReadAt: Date | null; sellerLastReadAt: Date | null }): Prisma.ChatMessageWhereInput {
    const readAt = c.buyerId === userId ? c.buyerLastReadAt : c.sellerLastReadAt;
    return { conversationId: c.id, senderId: { not: userId }, ...(readAt ? { createdAt: { gt: readAt } } : {}) };
  }

  /** My conversations, newest activity first. Empty ones the buyer started but never wrote in are hidden from the seller. */
  async list(userId: string): Promise<ConversationDto[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId, messages: { some: {} } }] },
      include: INCLUDE,
      orderBy: { lastMessageAt: "desc" },
      take: 100,
    });
    const unread = await Promise.all(rows.map((c) => this.prisma.chatMessage.count({ where: this.unreadWhere(userId, c) })));
    return rows.map((c, i) => this.view(userId, c, unread[i]));
  }

  async get(userId: string, id: string): Promise<ConversationDto> {
    const c = await this.own(userId, id);
    return this.view(userId, c, await this.prisma.chatMessage.count({ where: this.unreadWhere(userId, c) }));
  }

  async unreadTotal(userId: string): Promise<{ unread: number }> {
    const list = await this.list(userId);
    return { unread: list.reduce((n, c) => n + c.unread, 0) };
  }

  private async own(userId: string, id: string): Promise<Row> {
    const c = await this.prisma.conversation.findFirst({ where: { id, OR: [{ buyerId: userId }, { sellerId: userId }] }, include: INCLUDE });
    if (!c) throw new AppException(HttpStatus.NOT_FOUND, "CONVERSATION_NOT_FOUND", "We couldn't find that conversation.");
    return c;
  }

  /** Opens (or reuses) the conversation with the seller of a listing, optionally sending a first message. */
  async start(userId: string, productSlug: string, text?: string): Promise<ConversationDto> {
    const product = await this.prisma.product.findFirst({ where: { slug: productSlug, status: { not: "DRAFT" } }, select: { id: true, sellerId: true } });
    if (!product) throw new AppException(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "This item isn't available any more.");
    if (!product.sellerId) throw new AppException(HttpStatus.BAD_REQUEST, "NO_SELLER", "This item doesn't have a seller you can message.");
    if (product.sellerId === userId) throw new AppException(HttpStatus.BAD_REQUEST, "OWN_LISTING", "This is your own listing.");
    const c = await this.prisma.conversation.upsert({
      where: { productId_buyerId: { productId: product.id, buyerId: userId } },
      create: { productId: product.id, buyerId: userId, sellerId: product.sellerId },
      update: {},
    });
    if (text) await this.send(userId, c.id, text);
    return this.get(userId, c.id);
  }

  async messages(userId: string, id: string, before: string | undefined, limit: number): Promise<MessagePageDto> {
    await this.own(userId, id);
    const rows = await this.prisma.chatMessage.findMany({
      where: { conversationId: id, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });
    return { items: rows.slice(0, limit).reverse().map(toMessage), hasMore: rows.length > limit };
  }

  async send(userId: string, id: string, text: string): Promise<ChatMessageDto> {
    const c = await this.own(userId, id);
    const now = new Date();
    const [m] = await this.prisma.$transaction([
      this.prisma.chatMessage.create({ data: { conversationId: id, senderId: userId, text, createdAt: now } }),
      this.prisma.conversation.update({
        where: { id },
        // Sending also means you've read everything before it.
        data: { lastMessageAt: now, ...(c.buyerId === userId ? { buyerLastReadAt: now } : { sellerLastReadAt: now }) },
      }),
    ]);
    const message = toMessage(m);
    await this.events.publish([c.buyerId, c.sellerId], { type: "message", conversationId: id, message });
    return message;
  }

  async markRead(userId: string, id: string): Promise<void> {
    const c = await this.own(userId, id);
    const readAt = new Date();
    await this.prisma.conversation.update({ where: { id }, data: c.buyerId === userId ? { buyerLastReadAt: readAt } : { sellerLastReadAt: readAt } });
    await this.events.publish([c.buyerId, c.sellerId], { type: "read", conversationId: id, readerId: userId, readAt: readAt.toISOString() });
  }

  async typing(userId: string, id: string): Promise<void> {
    const c = await this.own(userId, id);
    await this.events.publish([c.buyerId === userId ? c.sellerId : c.buyerId], { type: "typing", conversationId: id, userId });
  }
}
