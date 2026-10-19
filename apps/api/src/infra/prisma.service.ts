import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

export const PRISMA_CLIENT = Symbol("PRISMA_CLIENT");

/** Owns the Prisma client lifecycle and exposes a cheap connectivity probe. */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  constructor(@Inject(PRISMA_CLIENT) private readonly client: PrismaClient) {}

  /** Resolves when PostgreSQL answers a trivial query; rejects otherwise. */
  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
