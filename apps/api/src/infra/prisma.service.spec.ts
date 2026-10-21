import type { PrismaClient } from "@prisma/client";
import { PrismaService } from "./prisma.service";

function setup() {
  const client = {
    $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]),
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PrismaService(client as unknown as PrismaClient);
  return { client, service };
}

describe("PrismaService", () => {
  it("resolves ping when PostgreSQL answers SELECT 1", async () => {
    const { client, service } = setup();
    await expect(service.ping()).resolves.toBeUndefined();
    expect(client.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("rejects ping when the query fails", async () => {
    const { client, service } = setup();
    client.$queryRaw.mockRejectedValue(new Error("Can't reach database server"));
    await expect(service.ping()).rejects.toThrow();
  });

  it("connects at startup", async () => {
    const { client, service } = setup();
    await service.onModuleInit();
    expect(client.$connect).toHaveBeenCalledTimes(1);
  });

  it("still starts when the database is unreachable", async () => {
    const { client, service } = setup();
    client.$connect.mockRejectedValue(new Error("Can't reach database server"));
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it("disconnects on shutdown", async () => {
    const { client, service } = setup();
    await service.onModuleDestroy();
    expect(client.$disconnect).toHaveBeenCalledTimes(1);
  });
});
