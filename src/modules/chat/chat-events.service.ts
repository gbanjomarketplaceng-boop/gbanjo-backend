import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import Redis from "ioredis";
import { interval, map, merge, Observable, Subject } from "rxjs";
import { KvService } from "../../redis/kv.service";
import { REDIS } from "../../redis/redis.constants";
import type { ChatEvent } from "./dto/chat.dto";

const CHANNEL = "chat:events";
/** Keeps proxies / load balancers from closing an idle stream. */
const HEARTBEAT_MS = 25_000;

/**
 * Live chat delivery. Events are published to Redis so every API instance receives them,
 * then pushed to the users connected to that instance (GET /chat/events).
 * If Redis is unavailable, events go straight to the users connected to this instance
 * (everyone with a single server; with several servers, others see the message on their next refresh).
 */
@Injectable()
export class ChatEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Chat");
  private readonly listeners = new Map<string, Set<Subject<ChatEvent>>>();
  private subscriber?: Redis;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly kv: KvService,
  ) {}

  async onModuleInit() {
    // Own connection that waits for Redis (instead of failing fast) so the app starts even if Redis is down.
    this.subscriber = this.redis.duplicate({ maxRetriesPerRequest: null, commandTimeout: undefined });
    let lastLog = 0;
    this.subscriber.on("error", (e) => {
      if (Date.now() - lastLog < 60_000) return; // at most once a minute while Redis is down
      lastLog = Date.now();
      this.logger.error(`live chat between servers paused: ${e.message}`);
    });
    this.subscriber.on("message", (_channel, raw) => {
      try {
        const { userIds, event, from } = JSON.parse(raw) as { userIds: string[]; event: ChatEvent; from?: string };
        if (from === this.instance) return; // already delivered locally
        this.deliver(userIds, event);
      } catch (e) {
        this.logger.warn(`Bad chat event: ${String(e)}`);
      }
    });
    void this.subscriber.subscribe(CHANNEL).catch((e: Error) => this.logger.error(`chat subscribe failed: ${e.message}`));
  }

  async onModuleDestroy() {
    this.listeners.forEach((set) => set.forEach((s) => s.complete()));
    if (this.subscriber?.status !== "ready") return this.subscriber?.disconnect();
    await Promise.race([this.subscriber.quit(), new Promise((r) => setTimeout(r, 2000))]).catch(() => undefined);
    this.subscriber.disconnect();
  }

  private readonly instance = randomBytes(8).toString("hex");

  private deliver(userIds: string[], event: ChatEvent) {
    for (const id of userIds) this.listeners.get(id)?.forEach((s) => s.next(event));
  }

  /** Sends an event to these users: right away on this instance, and through Redis to the others. Never throws. */
  async publish(userIds: string[], event: ChatEvent) {
    this.deliver(userIds, event);
    if (!this.kv.redisUp) return;
    await this.redis.publish(CHANNEL, JSON.stringify({ userIds, event, from: this.instance })).catch((e: Error) => this.logger.warn(`chat publish skipped: ${e.message}`));
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
