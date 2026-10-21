import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/env";
import { PRISMA_CLIENT } from "../infra/prisma.service";
import { randomToken, sha256 } from "./crypto";

/** The stored form of a session cookie value: its SHA-256, as Prisma `Bytes`. */
export function hashToken(token: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(sha256(token));
}

export interface ActiveSession {
  sessionId: string;
  userId: string;
}

export interface NewSession {
  /** The cookie value. Returned once and never stored. */
  token: string;
  expiresAt: Date;
}

/**
 * Server-side sessions. The browser holds a random 256-bit value; the
 * database holds only its SHA-256, so a database leak yields no usable cookies.
 */
@Injectable()
export class SessionService {
  private readonly ttlMs: number;

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) config: Pick<AppConfig, "sessionTtlHours">,
  ) {
    this.ttlMs = config.sessionTtlHours * 3_600_000;
  }

  /** Creates a session; pass `tx` to create it inside the caller's transaction. */
  async create(userId: string, tx: Prisma.TransactionClient = this.prisma): Promise<NewSession> {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + this.ttlMs);
    await tx.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
    return { token, expiresAt };
  }

  /** Resolves a cookie value to its session, or null if unknown or expired. */
  async resolve(token: string | undefined): Promise<ActiveSession | null> {
    if (!token) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, userId: true, expiresAt: true },
    });
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }
    return { sessionId: session.id, userId: session.userId };
  }

  /** Deletes the session for a cookie value, if any. */
  async revoke(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  /** Deletes all expired sessions; returns how many were removed. */
  async purgeExpired(): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    return count;
  }
}
