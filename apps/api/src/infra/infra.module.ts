import { Global, Module } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/env";
import { PRISMA_CLIENT, PrismaService } from "./prisma.service";
import { REDIS_CLIENT, RedisService } from "./redis.service";

/** Connections to PostgreSQL and Redis, shared across the API. */
@Global()
@Module({
  providers: [
    {
      provide: PRISMA_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new PrismaClient({ datasources: { db: { url: config.databaseUrl } } }),
    },
    {
      provide: REDIS_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new Redis(config.redisUrl, {
          // Fail commands immediately while disconnected instead of queueing,
          // so health checks report "down" rather than hanging.
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 2000,
          retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
        }),
    },
    PrismaService,
    RedisService,
  ],
  exports: [PrismaService, RedisService],
})
export class InfraModule {}
