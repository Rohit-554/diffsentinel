import { PrismaClient } from "@prisma/client";
import { resetDatabase, testDatabaseUrl } from "./test-env";

const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });

beforeAll(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("database schema", () => {
  it("has every table from the first migration", async () => {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
      ORDER BY table_name`;
    expect(rows.map((r) => r.table_name)).toEqual([
      "audit_events",
      "installation_members",
      "installations",
      "repositories",
      "repository_access",
      "sessions",
      "users",
    ]);
  });

  it("enforces the unique keys the sync and sessions rely on", async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND indexdef LIKE 'CREATE UNIQUE INDEX%'
      ORDER BY indexname`;
    expect(rows.map((r) => r.indexname)).toEqual(
      expect.arrayContaining([
        "installation_members_pkey",
        "installations_github_installation_id_key",
        "repositories_github_repository_id_key",
        "repository_access_pkey",
        "sessions_token_hash_key",
        "users_github_user_id_key",
      ]),
    );
  });

  it("rejects a second user with the same GitHub user id", async () => {
    await prisma.user.create({ data: { githubUserId: 1n, login: "octocat" } });
    await expect(
      prisma.user.create({ data: { githubUserId: 1n, login: "renamed" } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("deletes a user's sessions and memberships with the user", async () => {
    const user = await prisma.user.create({ data: { githubUserId: 2n, login: "hubot" } });
    const installation = await prisma.installation.create({
      data: {
        githubInstallationId: 20n,
        accountId: 2n,
        accountLogin: "hubot",
        accountType: "User",
      },
    });
    await prisma.installationMember.create({
      data: { userId: user.id, installationId: installation.id, verifiedAt: new Date() },
    });
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: Buffer.alloc(32, 1),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.installationMember.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.installation.count({ where: { id: installation.id } })).toBe(1);
  });
});
