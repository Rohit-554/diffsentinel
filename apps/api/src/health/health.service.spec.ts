import { Logger } from "@nestjs/common";
import type { PrismaService } from "../infra/prisma.service";
import type { RedisService } from "../infra/redis.service";
import { HealthService } from "./health.service";

type Ping = jest.Mock<Promise<void>, []>;

function setup(timeoutMs = 2000) {
  const postgresPing: Ping = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  const redisPing: Ping = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  const service = new HealthService(
    { ping: postgresPing } as unknown as PrismaService,
    { ping: redisPing } as unknown as RedisService,
    timeoutMs,
  );
  return { service, postgresPing, redisPing };
}

describe("HealthService", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("reports liveness without touching dependencies", () => {
    const { service, postgresPing, redisPing } = setup();
    expect(service.liveness()).toEqual({
      status: "ok",
      service: "api",
      version: expect.any(String) as string,
    });
    expect(postgresPing).not.toHaveBeenCalled();
    expect(redisPing).not.toHaveBeenCalled();
  });

  it("is ready when every dependency is up", async () => {
    const { service } = setup();
    const result = await service.readiness();
    expect(result.status).toBe("ok");
    expect(result.checks.postgres).toMatchObject({ status: "up" });
    expect(result.checks.redis).toMatchObject({ status: "up" });
  });

  it("is unavailable when postgres is down", async () => {
    const { service, postgresPing } = setup();
    postgresPing.mockRejectedValue(new Error("Can't reach database server"));
    const result = await service.readiness();
    expect(result.status).toBe("unavailable");
    expect(result.checks.postgres).toMatchObject({ status: "down", error: "unreachable" });
    expect(result.checks.redis).toMatchObject({ status: "up" });
  });

  it("is unavailable when redis is down", async () => {
    const { service, redisPing } = setup();
    redisPing.mockRejectedValue(new Error("Connection is closed."));
    const result = await service.readiness();
    expect(result.status).toBe("unavailable");
    expect(result.checks.redis).toMatchObject({ status: "down", error: "unreachable" });
  });

  it("reports a hung dependency as a timeout within the time limit", async () => {
    const { service, postgresPing } = setup(50);
    postgresPing.mockReturnValue(new Promise<void>(() => undefined));
    const started = Date.now();
    const result = await service.readiness();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.checks.postgres).toMatchObject({ status: "down", error: "timeout" });
  });

  it("never exposes or logs the driver error message", async () => {
    const { service, postgresPing } = setup();
    const secretUrl = "postgresql://admin:hunter2@db.internal:5432/app";
    postgresPing.mockRejectedValue(
      Object.assign(new Error(`connection to ${secretUrl} failed`), { code: "ECONNREFUSED" }),
    );
    const result = await service.readiness();

    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(JSON.stringify(result)).not.toContain("db.internal");
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("ECONNREFUSED");
    expect(logged).not.toContain("hunter2");
    expect(logged).not.toContain("db.internal");
  });
});
