import { NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { TenantScope } from "../../src/authz/tenant-scope.service";
import { resetDatabase, testDatabaseUrl } from "./test-env";

const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
const scope = new TenantScope(prisma);

/**
 * X and Y are members of shared installation A; only X can access its private
 * repository P. Z is a member of installation B only. R is a removed installation.
 */
let ids: Record<"x" | "y" | "z" | "a" | "b" | "removed", string>;

beforeAll(async () => {
  await resetDatabase(prisma);
  const now = new Date();
  const user = (n: number, login: string) =>
    prisma.user.create({ data: { githubUserId: BigInt(n), login } });
  const inst = (n: number, status: "active" | "removed" = "active") =>
    prisma.installation.create({
      data: {
        githubInstallationId: BigInt(n),
        accountId: BigInt(n),
        accountLogin: `org-${n}`,
        accountType: "Organization",
        status,
      },
    });
  const [x, y, z] = await Promise.all([user(1, "x"), user(2, "y"), user(3, "z")]);
  const [a, b, removed] = await Promise.all([inst(10), inst(20), inst(30, "removed")]);
  ids = { x: x.id, y: y.id, z: z.id, a: a.id, b: b.id, removed: removed.id };

  const repository = (n: number, installationId: string, isPrivate = false) =>
    prisma.repository.create({
      data: {
        githubRepositoryId: BigInt(n),
        installationId,
        fullName: `repo-${n}`,
        defaultBranch: "main",
        private: isPrivate,
      },
    });
  const [shared, privateRepo, other, gone] = await Promise.all([
    repository(100, a.id),
    repository(101, a.id, true),
    repository(200, b.id),
    repository(300, removed.id),
  ]);

  await prisma.installationMember.createMany({
    data: [
      { userId: x.id, installationId: a.id, verifiedAt: now },
      { userId: y.id, installationId: a.id, verifiedAt: now },
      { userId: z.id, installationId: b.id, verifiedAt: now },
      { userId: x.id, installationId: removed.id, verifiedAt: now },
    ],
  });
  await prisma.repositoryAccess.createMany({
    data: [
      { userId: x.id, repositoryId: shared.id, verifiedAt: now },
      { userId: x.id, repositoryId: privateRepo.id, verifiedAt: now },
      { userId: y.id, repositoryId: shared.id, verifiedAt: now },
      { userId: z.id, repositoryId: other.id, verifiedAt: now },
      { userId: x.id, repositoryId: gone.id, verifiedAt: now },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function installations(userId: string): Promise<string[]> {
  const rows = await prisma.installation.findMany({
    where: scope.installationsFor(userId),
    select: { accountLogin: true },
    orderBy: { accountLogin: "asc" },
  });
  return rows.map((r) => r.accountLogin);
}

async function repositories(userId: string, installationId?: string): Promise<string[]> {
  const rows = await prisma.repository.findMany({
    where: scope.repositoriesFor(userId, installationId ? { installationId } : {}),
    select: { fullName: true },
    orderBy: { fullName: "asc" },
  });
  return rows.map((r) => r.fullName);
}

describe("TenantScope", () => {
  it("shows members their installations, excluding removed ones", async () => {
    expect(await installations(ids.x)).toEqual(["org-10"]);
    expect(await installations(ids.y)).toEqual(["org-10"]);
    expect(await installations(ids.z)).toEqual(["org-20"]);
  });

  it("shows each member only the repositories GitHub reported for them", async () => {
    expect(await repositories(ids.x)).toEqual(["repo-100", "repo-101"]);
    expect(await repositories(ids.y)).toEqual(["repo-100"]);
    expect(await repositories(ids.z)).toEqual(["repo-200"]);
  });

  it("returns nothing for another tenant's installation filter", async () => {
    expect(await repositories(ids.z, ids.a)).toEqual([]);
    expect(await repositories(ids.x, ids.a)).toEqual(["repo-100", "repo-101"]);
  });

  it("hides repositories of removed installations even with an access row", async () => {
    expect(await repositories(ids.x, ids.removed)).toEqual([]);
  });

  it("treats 'not yours', 'removed' and 'doesn't exist' alike", async () => {
    await expect(scope.assertInstallationVisible(ids.x, ids.a)).resolves.toBeUndefined();
    for (const installationId of [ids.b, ids.removed, "00000000-0000-0000-0000-000000000000"]) {
      const err = await scope
        .assertInstallationVisible(ids.x, installationId)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as NotFoundException).getResponse()).toEqual({
        error: "not_found",
        message: "Not found.",
      });
    }
  });
});
