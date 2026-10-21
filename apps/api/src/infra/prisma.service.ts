import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

export const PRISMA_CLIENT = Symbol("PRISMA_CLIENT");

/** Owns the Prisma client lifecycle and exposes a cheap connectivity probe. */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(PRISMA_CLIENT) private readonly client: PrismaClient) {}

  /**
   * Connects at startup so the first request doesn't pay for engine start-up
   * (which can exceed the readiness timeout). A database that is down doesn't
   * stop the API from starting: readiness reports it, and Prisma reconnects on use.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.$connect();
    } catch {
      // Reported by /health/ready.
    }
  }

  /** Resolves when PostgreSQL answers a trivial query; rejects otherwise. */
  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
