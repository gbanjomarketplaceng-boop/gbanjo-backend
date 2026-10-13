import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { interval, map, merge, Observable, Subject } from "rxjs";
import { REDIS } from "../../redis/redis.constants";
import type { ChatEvent } from "./dto/chat.dto";

const CHANNEL = "chat:events";
/** Keeps proxies / load balancers from closing an idle stream. */
const HEARTBEAT_MS = 25_000;

/**
 * Live chat delivery. Events are published to Redis so every API instance receives them,
 * then pushed to the users connected to that instance (GET /chat/events).
 */
@Injectable()
export class ChatEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Chat");
  private readonly listeners = new Map<string, Set<Subject<ChatEvent>>>();
  private subscriber?: Redis;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleInit() {
    this.subscriber = this.redis.duplicate();
    this.subscriber.on("error", (e) => this.logger.error(e.message));
    this.subscriber.on("message", (_channel, raw) => {
      try {
        const { userIds, event } = JSON.parse(raw) as { userIds: string[]; event: ChatEvent };
        for (const id of userIds) this.listeners.get(id)?.forEach((s) => s.next(event));
      } catch (e) {
        this.logger.warn(`Bad chat event: ${String(e)}`);
      }
    });
    await this.subscriber.subscribe(CHANNEL);
  }

  async onModuleDestroy() {
    this.listeners.forEach((set) => set.forEach((s) => s.complete()));
    await this.subscriber?.quit().catch(() => undefined);
  }

  /** Sends an event to these users on every instance. */
  async publish(userIds: string[], event: ChatEvent) {
    await this.redis.publish(CHANNEL, JSON.stringify({ userIds, event }));
  }

  /** The live stream for one connected user (plus a heartbeat). Cleans up when the client disconnects. */
  stream(userId: string): Observable<{ data: ChatEvent }> {
    return new Observable<{ data: ChatEvent }>((observer) => {
      const subject = new Subject<ChatEvent>();
      const set = this.listeners.get(userId) ?? new Set();
      set.add(subject);
      this.listeners.set(userId, set);
      const sub = merge(subject, interval(HEARTBEAT_MS).pipe(map((): ChatEvent => ({ type: "ping" }))))
        .pipe(map((data) => ({ data })))
        .subscribe(observer);
      observer.next({ data: { type: "ping" } }); // tells the client the stream is open
      return () => {
        sub.unsubscribe();
        set.delete(subject);
        if (!set.size) this.listeners.delete(userId);
      };
    });
  }

  /** Users with an open stream on this instance (for tests / health). */
  connectedCount() {
    return this.listeners.size;
  }
}
