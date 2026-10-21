import { PrismaClient } from "@prisma/client";
import { sha256 } from "../../src/auth/crypto";
import { hashToken, SessionService } from "../../src/auth/session.service";
import { resetDatabase, testDatabaseUrl } from "./test-env";

const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
const sessions = new SessionService(prisma, { sessionTtlHours: 8 });
let userId: string;

beforeAll(async () => {
  await resetDatabase(prisma);
  ({ id: userId } = await prisma.user.create({ data: { githubUserId: 100n, login: "octocat" } }));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("SessionService", () => {
  it("creates a session that resolves to its user and expires in 8 hours", async () => {
    const before = Date.now();
    const { token, expiresAt } = await sessions.create(userId);

    expect(await sessions.resolve(token)).toMatchObject({ userId });
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(8 * 3_600_000 - 1000);
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(8 * 3_600_000 + 1000);
  });

  it("stores only the SHA-256 of the cookie value", async () => {
    const { token } = await sessions.create(userId);
    const rows = await prisma.session.findMany({ where: { userId } });

    expect(rows.some((r) => Buffer.from(r.tokenHash).equals(sha256(token)))).toBe(true);
    const dump = await prisma.$queryRaw<{ dump: string }[]>`
      SELECT string_agg(s::text, ' ') AS dump FROM sessions s`;
    expect(dump[0]?.dump).not.toContain(token);
    expect(dump[0]?.dump).not.toContain(Buffer.from(token).toString("hex"));
  });

  it("treats an expired session as unauthenticated and deletes it", async () => {
    const { token } = await sessions.create(userId);
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await sessions.resolve(token)).toBeNull();
    expect(await prisma.session.count({ where: { tokenHash: hashToken(token) } })).toBe(0);
  });

  it("treats a forged or missing value as unauthenticated", async () => {
    expect(await sessions.resolve("forged-value")).toBeNull();
    expect(await sessions.resolve(undefined)).toBeNull();
    expect(await sessions.resolve("")).toBeNull();
  });

  it("revokes a session", async () => {
    const { token } = await sessions.create(userId);
    await sessions.revoke(token);
    expect(await sessions.resolve(token)).toBeNull();
  });

  it("purges only expired sessions", async () => {
    const live = await sessions.create(userId);
    const dead = await sessions.create(userId);
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(dead.token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await sessions.purgeExpired()).toBeGreaterThanOrEqual(1);
    expect(await sessions.resolve(live.token)).toMatchObject({ userId });
  });

  it("creates the session inside a caller's transaction", async () => {
    const token = await prisma
      .$transaction(async (tx) => {
        const created = await sessions.create(userId, tx);
        throw Object.assign(new Error("rollback"), { token: created.token });
      })
      .catch((err: { token: string }) => err.token);
    expect(await sessions.resolve(token)).toBeNull();
  });
});
