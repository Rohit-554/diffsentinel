import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import type { Redis } from "ioredis";

export const REDIS_CLIENT = Symbol("REDIS_CLIENT");

/** The subset of the ioredis client this service relies on. */
export type RedisClient = Pick<Redis, "ping" | "quit" | "disconnect" | "on">;

/** Owns the Redis client lifecycle and exposes a cheap connectivity probe. */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private lastErrorCode: string | undefined;

  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClient) {
    // Without an error listener ioredis would crash the process on connection
    // errors. Log only the error code, never the message: messages can include
    // the host and port, and the URL may carry credentials. Repeated errors with
    // the same code are logged once until the connection recovers.
    client.on("error", (err: NodeJS.ErrnoException) => {
      const code = err.code ?? err.name;
      if (code !== this.lastErrorCode) {
        this.logger.warn(`Redis connection error (${code})`);
        this.lastErrorCode = code;
      }
    });
    client.on("ready", () => {
      if (this.lastErrorCode !== undefined) {
        this.logger.log("Redis connection restored");
        this.lastErrorCode = undefined;
      }
    });
  }

  /** Resolves when Redis answers PING; rejects otherwise. */
  async ping(): Promise<void> {
    await this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
