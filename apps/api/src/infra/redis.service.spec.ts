import { EventEmitter } from "node:events";
import { Logger } from "@nestjs/common";
import { type RedisClient, RedisService } from "./redis.service";

class FakeRedis extends EventEmitter {
  ping = jest.fn<Promise<string>, []>().mockResolvedValue("PONG");
  quit = jest.fn<Promise<string>, []>().mockResolvedValue("OK");
  disconnect = jest.fn();
}

function setup() {
  const fake = new FakeRedis();
  const service = new RedisService(fake as unknown as RedisClient);
  return { fake, service };
}

describe("RedisService", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("resolves ping when Redis answers", async () => {
    const { fake, service } = setup();
    await expect(service.ping()).resolves.toBeUndefined();
    expect(fake.ping).toHaveBeenCalledTimes(1);
  });

  it("rejects ping when Redis fails", async () => {
    const { fake, service } = setup();
    fake.ping.mockRejectedValue(new Error("Connection is closed."));
    await expect(service.ping()).rejects.toThrow();
  });

  it("logs connection errors by code only, never the message", () => {
    const { fake } = setup();
    const err = Object.assign(
      new Error("connect ECONNREFUSED redis://:hunter2@cache.internal:6379"),
      { code: "ECONNREFUSED" },
    );
    fake.emit("error", err);

    expect(warn).toHaveBeenCalledTimes(1);
    const logged = String((warn.mock.calls as unknown[][])[0]?.[0]);
    expect(logged).toContain("ECONNREFUSED");
    expect(logged).not.toContain("hunter2");
    expect(logged).not.toContain("cache.internal");
  });

  it("logs a repeated error code once until the connection recovers", () => {
    const { fake } = setup();
    const err = Object.assign(new Error("x"), { code: "ECONNREFUSED" });
    fake.emit("error", err);
    fake.emit("error", err);
    expect(warn).toHaveBeenCalledTimes(1);

    fake.emit("ready");
    fake.emit("error", err);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("falls back to disconnect when quit fails on shutdown", async () => {
    const { fake, service } = setup();
    fake.quit.mockRejectedValue(new Error("not connected"));
    await service.onModuleDestroy();
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
  });
});
