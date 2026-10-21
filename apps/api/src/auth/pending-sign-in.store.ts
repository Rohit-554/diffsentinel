import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Redis } from "ioredis";
import { z } from "zod";
import { REDIS_CLIENT } from "../infra/redis.service";
import { PENDING_SIGN_IN_TTL_SECONDS } from "./cookies";
import { randomToken, sha256 } from "./crypto";

export const PENDING_SIGN_IN_TTL = Symbol("PENDING_SIGN_IN_TTL");

/** What a sign-in started with; checked and used once when GitHub redirects back. */
export interface PendingSignIn {
  state: string;
  codeVerifier: string;
}

const pendingSchema = z.object({ state: z.string().min(1), codeVerifier: z.string().min(1) });

type PendingStoreRedis = Pick<Redis, "set" | "getdel">;

/**
 * Pending sign-ins live in Redis under a hash of the cookie value, expire
 * after 10 minutes, and are deleted on first read so a callback can't be replayed.
 */
@Injectable()
export class PendingSignInStore {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: PendingStoreRedis,
    @Optional()
    @Inject(PENDING_SIGN_IN_TTL)
    private readonly ttlSeconds: number = PENDING_SIGN_IN_TTL_SECONDS,
  ) {}

  /** Stores the pending sign-in and returns the opaque ID to put in the cookie. */
  async create(pending: PendingSignIn): Promise<string> {
    const id = randomToken();
    await this.redis.set(key(id), JSON.stringify(pending), "EX", this.ttlSeconds, "NX");
    return id;
  }

  /** Returns and deletes the pending sign-in, or null if it is unknown, used or expired. */
  async consume(id: string): Promise<PendingSignIn | null> {
    const raw = await this.redis.getdel(key(id));
    if (raw === null) return null;
    try {
      const parsed = pendingSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}

function key(id: string): string {
  return `auth:pending:${sha256(id).toString("hex")}`;
}
