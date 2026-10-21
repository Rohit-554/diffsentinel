import { Redis } from "ioredis";
import { PendingSignInStore } from "../../src/auth/pending-sign-in.store";
import { testRedisUrl } from "./test-env";

const redis = new Redis(testRedisUrl);
const pending = { state: "state-123", codeVerifier: "verifier-456" };

afterAll(async () => {
  await redis.quit();
});

describe("PendingSignInStore", () => {
  const store = new PendingSignInStore(redis);

  it("returns a stored sign-in once, then nothing", async () => {
    const id = await store.create(pending);
    expect(await store.consume(id)).toEqual(pending);
    expect(await store.consume(id)).toBeNull();
  });

  it("stores entries under a hash of the cookie value, with a 10-minute TTL", async () => {
    const id = await store.create(pending);
    const keys = await redis.keys("auth:pending:*");
    expect(keys.some((k) => k.includes(id))).toBe(false);

    const ttls = await Promise.all(keys.map((k) => redis.ttl(k)));
    expect(Math.max(...ttls)).toBeGreaterThan(590);
    expect(Math.max(...ttls)).toBeLessThanOrEqual(600);
    await store.consume(id);
  });

  it("returns nothing for an unknown id", async () => {
    expect(await store.consume("never-issued")).toBeNull();
  });

  it("returns nothing after the entry expires", async () => {
    const shortLived = new PendingSignInStore(redis, 1);
    const id = await shortLived.create(pending);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await shortLived.consume(id)).toBeNull();
  });

  it("returns nothing for a corrupted entry", async () => {
    const id = await store.create(pending);
    const [key] = await redis.keys("auth:pending:*");
    await redis.set(key!, "{not json");
    expect(await store.consume(id)).toBeNull();
  });
});
