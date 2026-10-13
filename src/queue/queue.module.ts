import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env.validation";
import { redisOptions } from "../config/redis-options";

/**
 * BullMQ root connection. Register queues in feature modules with
 * `BullModule.registerQueue({ name: "emails" })` and add a `@Processor("emails")` worker.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: redisOptions(config),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      }),
    }),
  ],
})
export class QueueModule {}
