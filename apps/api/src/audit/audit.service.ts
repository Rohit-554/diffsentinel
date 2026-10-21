import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../infra/prisma.service";

export type AuditAction =
  "auth.sign_in" | "auth.sign_in_failed" | "auth.sign_out" | "installations.synced";

/** Flat, minimal metadata: counts and categories, never names, tokens or codes. */
export type AuditMetadata = Record<string, string | number | boolean | null>;

export interface AuditEventInput {
  action: AuditAction;
  actorUserId?: string | null;
  resourceType?: string;
  resourceId?: string;
  metadata?: AuditMetadata;
}

// A defence against accidentally auditing a credential, checked on every write.
const SECRET_LIKE_KEY = /token|code|secret|session|password|cookie|credential|key/i;

export class UnsafeAuditMetadataError extends Error {
  override readonly name = "UnsafeAuditMetadataError";
}

@Injectable()
export class AuditService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  /** Records an event; pass `tx` to make it part of the caller's transaction. */
  async record(event: AuditEventInput, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    const metadata = event.metadata ?? {};
    const unsafe = Object.keys(metadata).filter((key) => SECRET_LIKE_KEY.test(key));
    if (unsafe.length > 0) {
      throw new UnsafeAuditMetadataError(`Refusing audit metadata keys: ${unsafe.join(", ")}`);
    }
    await tx.auditEvent.create({
      data: {
        action: event.action,
        actorUserId: event.actorUserId ?? null,
        resourceType: event.resourceType ?? null,
        resourceId: event.resourceId ?? null,
        metadata,
      },
    });
  }
}
