import { type INestApplication, Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";
import { configureApp } from "../src/app.setup";
import { HealthController } from "../src/health/health.controller";
import { HealthService } from "../src/health/health.service";
import { PrismaService } from "../src/infra/prisma.service";
import { RedisService } from "../src/infra/redis.service";

describe("Health endpoints (e2e)", () => {
  let app: INestApplication<App>;
  const postgres = { ping: jest.fn<Promise<void>, []>() };
  const redis = { ping: jest.fn<Promise<void>, []>() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: PrismaService, useValue: postgres },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    postgres.ping.mockResolvedValue(undefined);
    redis.ping.mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/v1/health returns 200 even when dependencies are down", async () => {
    postgres.ping.mockRejectedValue(new Error("down"));
    redis.ping.mockRejectedValue(new Error("down"));

    const res = await request(app.getHttpServer()).get("/api/v1/health").expect(200);
    expect(res.body).toMatchObject({ status: "ok", service: "api" });
  });

  it("GET /api/v1/health/ready returns 200 when all dependencies are up", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/health/ready").expect(200);
    expect(res.body).toMatchObject({
      status: "ok",
      service: "api",
      checks: { postgres: { status: "up" }, redis: { status: "up" } },
    });
  });

  it("GET /api/v1/health/ready returns 503 with per-dependency results when one is down", async () => {
    redis.ping.mockRejectedValue(new Error("redis://:hunter2@cache:6379 refused"));

    const res = await request(app.getHttpServer()).get("/api/v1/health/ready").expect(503);
    expect(res.body).toMatchObject({
      status: "unavailable",
      checks: {
        postgres: { status: "up" },
        redis: { status: "down", error: "unreachable" },
      },
    });
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
  });

  it("serves the OpenAPI document", async () => {
    const res = await request(app.getHttpServer()).get("/api/docs-json").expect(200);
    const { paths } = res.body as { paths: Record<string, unknown> };
    expect(Object.keys(paths)).toEqual(
      expect.arrayContaining(["/api/v1/health", "/api/v1/health/ready"]),
    );
  });
});
