import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { pgConnectionString } from "./database-url";
import type { Env } from "../config/env.validation";
import { PrismaClient } from "../generated/prisma/client";

/** Prisma client using the node-postgres (pg) driver adapter. Inject it anywhere. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super({ adapter: new PrismaPg({ connectionString: pgConnectionString(config.get("DATABASE_URL", { infer: true })) }) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
