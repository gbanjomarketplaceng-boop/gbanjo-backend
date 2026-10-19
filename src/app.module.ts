import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import Redis from "ioredis";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { type Env, validateEnv } from "./config/env.validation";
import { AuthModule } from "./modules/auth/auth.module";
import { BannersModule } from "./modules/banners/banners.module";
import { CatalogModule } from "./modules/catalog/catalog.module";
import { AddressesModule } from "./modules/addresses/addresses.module";
import { ChatModule } from "./modules/chat/chat.module";
import { ReviewsModule } from "./modules/reviews/reviews.module";
import { CartModule } from "./modules/cart/cart.module";
import { SellerModule } from "./modules/seller/seller.module";
import { WishlistModule } from "./modules/wishlist/wishlist.module";
import { ContactModule } from "./modules/contact/contact.module";
import { JwtAuthGuard } from "./modules/auth/guards/jwt-auth.guard";
import { HealthController } from "./modules/health/health.controller";
import { UsersModule } from "./modules/users/users.module";
import { UploadsModule } from "./modules/uploads/uploads.module";
import { WalletModule } from "./modules/wallet/wallet.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { InboxModule } from "./modules/inbox/inbox.module";
import { SafetyModule } from "./modules/safety/safety.module";
import { AdminModule } from "./modules/admin/admin.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { IdempotencyModule } from "./common/idempotency/idempotency.module";
import { PrismaModule } from "./prisma/prisma.module";
import { QueueModule } from "./queue/queue.module";
import { REDIS } from "./redis/redis.constants";
import { RedisModule } from "./redis/redis.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    PrismaModule,
    RedisModule,
    IdempotencyModule,
    QueueModule,
    SettingsModule,
    // Rate limits are counted in Redis so they hold across multiple API instances.
    ThrottlerModule.forRootAsync({
      inject: [REDIS, ConfigService],
      useFactory: (redis: Redis, config: ConfigService<Env, true>) => ({
        throttlers: [{ name: "default", ttl: 60_000, limit: 120 }],
        storage: new ThrottlerStorageRedisService(redis),
        // The e2e suite fires many auth requests from one IP.
        skipIf: () => config.get("NODE_ENV", { infer: true }) === "test",
      }),
    }),
    AuthModule,
    UsersModule,
    WalletModule,
    CatalogModule,
    UploadsModule,
    BannersModule,
    ContactModule,
    WishlistModule,
    CartModule,
    SellerModule,
    AddressesModule,
    ChatModule,
    ReviewsModule,
    InboxModule,
    PaymentsModule,
    OrdersModule,
    SafetyModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
