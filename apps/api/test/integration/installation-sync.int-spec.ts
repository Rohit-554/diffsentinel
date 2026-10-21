import { PrismaClient } from "@prisma/client";
import { AuditService } from "../../src/audit/audit.service";
import { GitHubUnavailableError } from "../../src/github/github-http";
import {
  InstallationSyncService,
  SYNC_LIMITS,
} from "../../src/installations/installation-sync.service";
import { FakeGitHubUsers, installation, repo } from "./fake-github";
import { resetDatabase, testDatabaseUrl } from "./test-env";

const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
let github: FakeGitHubUsers;
let sync: InstallationSyncService;

const ALICE = "token-alice";
const BOB = "token-bob";

beforeEach(async () => {
  await resetDatabase(prisma);
  github = new FakeGitHubUsers();
  sync = new InstallationSyncService(prisma, github, new AuditService(prisma));
  github.accounts.set(ALICE, {
    user: { id: 1, login: "alice", name: "Alice" },
    installations: [installation(100)],
    repositories: { 100: [repo(1), repo(2, true)] },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const noop = () => Promise.resolve(undefined);

async function visibleRepositories(login: string): Promise<string[]> {
  const rows = await prisma.repositoryAccess.findMany({
    where: { user: { login } },
    select: { repository: { select: { fullName: true } } },
  });
  return rows.map((r) => r.repository.fullName).sort();
}

async function memberships(login: string): Promise<bigint[]> {
  const rows = await prisma.installationMember.findMany({
    where: { user: { login } },
    select: { installation: { select: { githubInstallationId: true } } },
  });
  return rows.map((r) => r.installation.githubInstallationId).sort();
}

describe("InstallationSyncService", () => {
  it("records the user, installation, membership and repositories on first sync", async () => {
    const { summary } = await sync.run(ALICE, noop);

    expect(summary).toEqual({
      installationsAdded: 1,
      installationsRemoved: 0,
      repositoriesAdded: 2,
      repositoriesRemoved: 0,
    });
    expect(await prisma.user.findFirst()).toMatchObject({
      githubUserId: 1n,
      login: "alice",
      displayName: "Alice",
      installationsTruncated: false,
    });
    expect(await memberships("alice")).toEqual([100n]);
    expect(await visibleRepositories("alice")).toEqual(["acme/repo-1", "acme/repo-2"]);
    expect(await prisma.installation.findFirst()).toMatchObject({
      accountLogin: "acme",
      accountType: "Organization",
      status: "active",
    });
  });

  it("audits the sync with counts only", async () => {
    await sync.run(ALICE, noop);
    const [event] = await prisma.auditEvent.findMany({ where: { action: "installations.synced" } });
    expect(event?.metadata).toEqual({
      installationsAdded: 1,
      installationsRemoved: 0,
      repositoriesAdded: 2,
      repositoriesRemoved: 0,
    });
    expect(JSON.stringify(event)).not.toContain("acme/repo");
  });

  it("is idempotent", async () => {
    await sync.run(ALICE, noop);
    const { summary } = await sync.run(ALICE, noop);
    expect(summary).toEqual({
      installationsAdded: 0,
      installationsRemoved: 0,
      repositoriesAdded: 0,
      repositoriesRemoved: 0,
    });
    expect(await prisma.repository.count()).toBe(2);
  });

  it("drops a repository removed from the installation's selection", async () => {
    await sync.run(ALICE, noop);
    github.accounts.get(ALICE)!.repositories[100] = [repo(1)];

    const { summary } = await sync.run(ALICE, noop);

    expect(summary.repositoriesRemoved).toBe(1);
    expect(await visibleRepositories("alice")).toEqual(["acme/repo-1"]);
  });

  it("updates renamed repositories", async () => {
    await sync.run(ALICE, noop);
    github.accounts.get(ALICE)!.repositories[100] = [
      { ...repo(1), fullName: "acme/renamed", defaultBranch: "trunk" },
      repo(2, true),
    ];
    await sync.run(ALICE, noop);
    expect(await prisma.repository.findUnique({ where: { githubRepositoryId: 1n } })).toMatchObject(
      { fullName: "acme/renamed", defaultBranch: "trunk" },
    );
  });

  it("removes the membership and access when GitHub no longer reports the installation", async () => {
    await sync.run(ALICE, noop);
    const account = github.accounts.get(ALICE)!;
    account.installations = [];
    account.repositories = {};

    const { summary } = await sync.run(ALICE, noop);

    expect(summary).toMatchObject({ installationsRemoved: 1, repositoriesRemoved: 2 });
    expect(await memberships("alice")).toEqual([]);
    expect(await visibleRepositories("alice")).toEqual([]);
    // Shared rows stay; they are simply no longer visible to this user.
    expect(await prisma.installation.count()).toBe(1);
  });

  it("records a suspended installation without listing its repositories", async () => {
    github.accounts.get(ALICE)!.installations = [installation(100, "acme", true)];
    github.failingInstallations.add(100);

    await sync.run(ALICE, noop);

    expect(await prisma.installation.findFirst()).toMatchObject({ status: "suspended" });
    expect(await memberships("alice")).toEqual([100n]);
    expect(await visibleRepositories("alice")).toEqual([]);
  });

  describe("shared installations", () => {
    beforeEach(() => {
      // Bob is in the same organization but can't see the private repo-2.
      github.accounts.set(BOB, {
        user: { id: 2, login: "bob", name: null },
        installations: [installation(100)],
        repositories: { 100: [repo(1)] },
      });
    });

    it("stores the installation once and gives each member only their own repositories", async () => {
      await sync.run(ALICE, noop);
      await sync.run(BOB, noop);

      expect(await prisma.installation.count()).toBe(1);
      expect(await prisma.repository.count()).toBe(2);
      expect(await visibleRepositories("alice")).toEqual(["acme/repo-1", "acme/repo-2"]);
      expect(await visibleRepositories("bob")).toEqual(["acme/repo-1"]);
    });

    it("removes only the syncing member's access", async () => {
      await sync.run(ALICE, noop);
      await sync.run(BOB, noop);
      github.accounts.get(BOB)!.installations = [];

      await sync.run(BOB, noop);

      expect(await memberships("bob")).toEqual([]);
      expect(await memberships("alice")).toEqual([100n]);
      expect(await visibleRepositories("alice")).toEqual(["acme/repo-1", "acme/repo-2"]);
    });
  });

  describe("limits", () => {
    it("stores at most the repository cap and flags the membership as truncated", async () => {
      const many = Array.from({ length: SYNC_LIMITS.repositoriesPerInstallation + 5 }, (_, i) =>
        repo(i + 1),
      );
      github.accounts.get(ALICE)!.repositories[100] = many;

      await sync.run(ALICE, noop);

      expect(await prisma.repositoryAccess.count()).toBe(SYNC_LIMITS.repositoriesPerInstallation);
      expect(await prisma.installationMember.findFirst()).toMatchObject({
        repositoriesTruncated: true,
      });
    });

    it("stores at most the installation cap and flags the user as truncated", async () => {
      const account = github.accounts.get(ALICE)!;
      account.installations = Array.from({ length: SYNC_LIMITS.installations + 3 }, (_, i) =>
        installation(1000 + i, `org-${i}`),
      );

      await sync.run(ALICE, noop);

      expect(await prisma.installationMember.count()).toBe(SYNC_LIMITS.installations);
      expect(await prisma.user.findFirst()).toMatchObject({ installationsTruncated: true });
    });
  });

  describe("failures", () => {
    it("changes nothing when GitHub fails part-way through reading", async () => {
      await sync.run(ALICE, noop);
      const account = github.accounts.get(ALICE)!;
      account.installations = [installation(100), installation(200, "other")];
      account.repositories[100] = [];
      account.repositories[200] = [repo(9)];
      github.failingInstallations.add(200);

      await expect(sync.run(ALICE, noop)).rejects.toBeInstanceOf(GitHubUnavailableError);

      expect(await memberships("alice")).toEqual([100n]);
      expect(await visibleRepositories("alice")).toEqual(["acme/repo-1", "acme/repo-2"]);
      expect(await prisma.installation.count()).toBe(1);
    });

    it("rolls back the sync when the follow-up step fails", async () => {
      await expect(
        sync.run(ALICE, () => Promise.reject(new Error("session failed"))),
      ).rejects.toThrow("session failed");
      expect(await prisma.user.count()).toBe(0);
      expect(await prisma.auditEvent.count()).toBe(0);
    });

    it("runs the follow-up step in the same transaction with the user's id", async () => {
      const { userId, result } = await sync.run(ALICE, async (tx, id) =>
        tx.user.findUnique({ where: { id }, select: { login: true } }),
      );
      expect(result).toEqual({ login: "alice" });
      expect(userId).toEqual((await prisma.user.findFirst())?.id);
    });
  });
});
