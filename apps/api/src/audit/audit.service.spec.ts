import type { PrismaClient } from "@prisma/client";
import { AuditService, UnsafeAuditMetadataError } from "./audit.service";

function serviceWithFakeDb() {
  const create = jest.fn<Promise<unknown>, [unknown]>(() => Promise.resolve({}));
  const prisma = { auditEvent: { create } } as unknown as PrismaClient;
  return { audit: new AuditService(prisma), create };
}

describe("AuditService", () => {
  it("writes the event with defaults for omitted fields", async () => {
    const { audit, create } = serviceWithFakeDb();
    await audit.record({ action: "auth.sign_out", actorUserId: "u1" });
    expect(create).toHaveBeenCalledWith({
      data: {
        action: "auth.sign_out",
        actorUserId: "u1",
        resourceType: null,
        resourceId: null,
        metadata: {},
      },
    });
  });

  it.each(["token", "accessToken", "code", "client_secret", "sessionId", "cookie", "apiKey"])(
    "refuses metadata key %s",
    async (key) => {
      const { audit, create } = serviceWithFakeDb();
      await expect(
        audit.record({ action: "auth.sign_in", metadata: { [key]: "x" } }),
      ).rejects.toBeInstanceOf(UnsafeAuditMetadataError);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("accepts counts and reason categories", async () => {
    const { audit, create } = serviceWithFakeDb();
    await audit.record({
      action: "installations.synced",
      metadata: { installationsAdded: 1, repositoriesRemoved: 0, reason: "ok" },
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
