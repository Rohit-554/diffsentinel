import { PrismaClient } from "@prisma/client";
import { AuditService } from "../../src/audit/audit.service";
import { resetDatabase, testDatabaseUrl } from "./test-env";

const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
const audit = new AuditService(prisma);

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("AuditService", () => {
  it("writes an event with its metadata", async () => {
    const user = await prisma.user.create({ data: { githubUserId: 1n, login: "octocat" } });
    await audit.record({
      action: "auth.sign_in",
      actorUserId: user.id,
      metadata: { installations: 2 },
    });

    const events = await prisma.auditEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "auth.sign_in",
      actorUserId: user.id,
      metadata: { installations: 2 },
    });
  });

  it("rolls back with the caller's transaction", async () => {
    await prisma
      .$transaction(async (tx) => {
        await audit.record({ action: "auth.sign_in_failed", metadata: { reason: "x" } }, tx);
        throw new Error("rollback");
      })
      .catch(() => undefined);
    expect(await prisma.auditEvent.count()).toBe(0);
  });

  it("keeps events when the actor is deleted", async () => {
    const user = await prisma.user.create({ data: { githubUserId: 2n, login: "hubot" } });
    await audit.record({ action: "auth.sign_out", actorUserId: user.id });
    await prisma.user.delete({ where: { id: user.id } });

    const [event] = await prisma.auditEvent.findMany();
    expect(event).toMatchObject({ action: "auth.sign_out", actorUserId: null });
  });
});
