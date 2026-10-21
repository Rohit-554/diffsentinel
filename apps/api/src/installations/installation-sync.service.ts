import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import type {
  Capped,
  GitHubInstallation,
  GitHubRepository,
  GitHubUser,
  GitHubUserClient,
} from "../github/github-user.client";
import { GITHUB_USER_CLIENT } from "../github/github.module";
import { PRISMA_CLIENT } from "../infra/prisma.service";

/** Upper bounds on one sync: at most 1 + 20 × 3 = 61 GitHub listing requests. */
export const SYNC_LIMITS = {
  installations: 20,
  repositoriesPerInstallation: 300,
  concurrency: 4,
} as const;

/** Everything GitHub reported for the user, read before any database write. */
export interface GitHubSnapshot {
  user: GitHubUser;
  installationsTruncated: boolean;
  installations: { installation: GitHubInstallation; repositories: Capped<GitHubRepository> }[];
}

export interface SyncSummary {
  installationsAdded: number;
  installationsRemoved: number;
  repositoriesAdded: number;
  repositoriesRemoved: number;
}

export type UserReader = Pick<
  GitHubUserClient,
  "getUser" | "listInstallations" | "listRepositories"
>;

/**
 * Mirrors what GitHub reports a user can access into installations,
 * memberships and per-user repository access. Reads everything from GitHub
 * first, then writes in one transaction, so a GitHub failure changes nothing.
 * Only the syncing user's memberships and access rows are ever removed.
 */
@Injectable()
export class InstallationSyncService {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(GITHUB_USER_CLIENT) private readonly github: UserReader,
    private readonly audit: AuditService,
  ) {}

  /**
   * Reads from GitHub, then applies the result and runs `then` in the same
   * transaction (the callback uses it to create the session).
   */
  async run<T>(
    token: string,
    then: (tx: Prisma.TransactionClient, userId: string) => Promise<T>,
  ): Promise<{ userId: string; summary: SyncSummary; result: T }> {
    const snapshot = await this.read(token);
    return this.prisma.$transaction(
      async (tx) => {
        const { userId, summary } = await this.apply(snapshot, tx);
        return { userId, summary, result: await then(tx, userId) };
      },
      { timeout: 15_000 },
    );
  }

  async read(token: string): Promise<GitHubSnapshot> {
    const user = await this.github.getUser(token);
    const installations = await this.github.listInstallations(token, SYNC_LIMITS.installations);
    const entries = await mapWithConcurrency(
      installations.items,
      SYNC_LIMITS.concurrency,
      async (installation) => ({
        installation,
        // GitHub refuses API access to suspended installations; list them without repositories.
        repositories: installation.suspended
          ? { items: [], truncated: false }
          : await this.github.listRepositories(
              token,
              installation.id,
              SYNC_LIMITS.repositoriesPerInstallation,
            ),
      }),
    );
    return { user, installationsTruncated: installations.truncated, installations: entries };
  }

  async apply(
    snapshot: GitHubSnapshot,
    tx: Prisma.TransactionClient,
  ): Promise<{ userId: string; summary: SyncSummary }> {
    const now = new Date();
    const { id: userId } = await tx.user.upsert({
      where: { githubUserId: BigInt(snapshot.user.id) },
      create: {
        githubUserId: BigInt(snapshot.user.id),
        login: snapshot.user.login,
        displayName: snapshot.user.name,
        installationsTruncated: snapshot.installationsTruncated,
      },
      update: {
        login: snapshot.user.login,
        displayName: snapshot.user.name,
        installationsTruncated: snapshot.installationsTruncated,
      },
      select: { id: true },
    });

    const previousInstallations = new Set(
      (
        await tx.installationMember.findMany({
          where: { userId },
          select: { installationId: true },
        })
      ).map((m) => m.installationId),
    );
    const previousRepositories = new Set(
      (
        await tx.repositoryAccess.findMany({ where: { userId }, select: { repositoryId: true } })
      ).map((a) => a.repositoryId),
    );

    const installationIds: string[] = [];
    const repositoryIds: string[] = [];
    for (const { installation, repositories } of snapshot.installations) {
      const fields = {
        accountId: BigInt(installation.account.id),
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        status: installation.suspended ? ("suspended" as const) : ("active" as const),
      };
      const { id: installationId } = await tx.installation.upsert({
        where: { githubInstallationId: BigInt(installation.id) },
        create: { githubInstallationId: BigInt(installation.id), ...fields },
        update: fields,
        select: { id: true },
      });
      installationIds.push(installationId);

      await tx.installationMember.upsert({
        where: { userId_installationId: { userId, installationId } },
        create: {
          userId,
          installationId,
          verifiedAt: now,
          repositoriesTruncated: repositories.truncated,
        },
        update: { verifiedAt: now, repositoriesTruncated: repositories.truncated },
      });

      repositoryIds.push(...(await upsertRepositories(tx, installationId, repositories.items)));
    }

    await tx.installationMember.deleteMany({
      where: { userId, installationId: { notIn: installationIds } },
    });
    await tx.repositoryAccess.deleteMany({
      where: { userId, repositoryId: { notIn: repositoryIds } },
    });
    if (repositoryIds.length > 0) {
      await tx.$executeRaw`
        INSERT INTO repository_access (user_id, repository_id, verified_at)
        SELECT ${userId}::uuid, repository_id, ${now}
        FROM unnest(${repositoryIds}::text[]::uuid[]) AS repository_id
        ON CONFLICT (user_id, repository_id) DO UPDATE SET verified_at = EXCLUDED.verified_at`;
    }

    const summary: SyncSummary = {
      installationsAdded: installationIds.filter((id) => !previousInstallations.has(id)).length,
      installationsRemoved: countMissing(previousInstallations, installationIds),
      repositoriesAdded: repositoryIds.filter((id) => !previousRepositories.has(id)).length,
      repositoriesRemoved: countMissing(previousRepositories, repositoryIds),
    };
    await this.audit.record(
      {
        action: "installations.synced",
        actorUserId: userId,
        resourceType: "user",
        resourceId: userId,
        metadata: { ...summary },
      },
      tx,
    );
    return { userId, summary };
  }
}

/** Inserts or updates an installation's repositories in one statement; returns their ids. */
async function upsertRepositories(
  tx: Prisma.TransactionClient,
  installationId: string,
  repositories: GitHubRepository[],
): Promise<string[]> {
  if (repositories.length === 0) return [];
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO repositories
      (github_repository_id, installation_id, full_name, default_branch, private, updated_at)
    SELECT r.github_id, ${installationId}::uuid, r.full_name, r.default_branch, r.private, now()
    FROM unnest(
      ${repositories.map((r) => String(r.id))}::text[]::bigint[],
      ${repositories.map((r) => r.fullName)}::text[],
      ${repositories.map((r) => r.defaultBranch)}::text[],
      ${repositories.map((r) => r.private)}::boolean[]
    ) AS r(github_id, full_name, default_branch, private)
    ON CONFLICT (github_repository_id) DO UPDATE SET
      installation_id = EXCLUDED.installation_id,
      full_name = EXCLUDED.full_name,
      default_branch = EXCLUDED.default_branch,
      private = EXCLUDED.private,
      updated_at = now()
    RETURNING id::text AS id`;
  return rows.map((row) => row.id);
}

function countMissing(previous: Set<string>, current: string[]): number {
  const kept = new Set(current);
  return [...previous].filter((id) => !kept.has(id)).length;
}

/** Maps with at most `limit` calls in flight; rejects on the first failure. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
