import { ConfigValidationError, parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
};

function problemsFor(env: Record<string, string | undefined>): string[] {
  try {
    parseEnv(env);
  } catch (err) {
    if (err instanceof ConfigValidationError) return err.problems;
    throw err;
  }
  throw new Error("expected parseEnv to throw");
}

describe("parseEnv", () => {
  it("applies defaults when only required variables are set", () => {
    const config = parseEnv(valid);
    expect(config).toMatchObject({
      nodeEnv: "development",
      port: 3000,
      databaseUrl: valid.DATABASE_URL,
      redisUrl: valid.REDIS_URL,
    });
    expect(config.logLevels).toEqual(["fatal", "error", "warn", "log"]);
  });

  it("rejects a missing DATABASE_URL", () => {
    const problems = problemsFor({ REDIS_URL: valid.REDIS_URL });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^DATABASE_URL: /);
  });

  it("rejects a REDIS_URL with the wrong scheme", () => {
    const problems = problemsFor({ ...valid, REDIS_URL: "http://localhost:6379" });
    expect(problems).toEqual(["REDIS_URL: must be a valid URL using redis: or rediss:"]);
  });

  it("rejects a port outside 1-65535", () => {
    expect(problemsFor({ ...valid, API_PORT: "70000" })[0]).toMatch(/^API_PORT: /);
  });

  it("rejects an unknown LOG_LEVEL", () => {
    expect(problemsFor({ ...valid, LOG_LEVEL: "loud" })[0]).toMatch(/^LOG_LEVEL: /);
  });

  it("never includes the supplied value in errors", () => {
    const secret = "s3cr3t-Pa55word";
    const err = (() => {
      try {
        parseEnv({ ...valid, DATABASE_URL: `mysql://admin:${secret}@db:3306/x` });
      } catch (e) {
        return e as Error;
      }
      throw new Error("expected parseEnv to throw");
    })();
    expect(err.message).toContain("DATABASE_URL");
    expect(err.message).not.toContain(secret);
    expect(JSON.stringify(err)).not.toContain(secret);
  });
});
