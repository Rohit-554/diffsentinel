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

  describe("GitHub sign-in settings", () => {
    const github = {
      GITHUB_APP_CLIENT_ID: "Iv23liExample",
      GITHUB_APP_CLIENT_SECRET: "client-secret-value-123",
      GITHUB_APP_SLUG: "diffsentinel-dev",
      PUBLIC_BASE_URL: "http://localhost:8080",
    };

    it("disables sign-in when none are set", () => {
      expect(parseEnv(valid).github).toBeNull();
    });

    it("treats empty strings from Compose as unset", () => {
      const empty = Object.fromEntries(Object.keys(github).map((k) => [k, ""]));
      expect(parseEnv({ ...valid, ...empty }).github).toBeNull();
    });

    it("enables sign-in when all are set, normalising the base URL to an origin", () => {
      const config = parseEnv({ ...valid, ...github, PUBLIC_BASE_URL: "http://localhost:8080/" });
      expect(config.github).toEqual({
        clientId: github.GITHUB_APP_CLIENT_ID,
        clientSecret: github.GITHUB_APP_CLIENT_SECRET,
        appSlug: github.GITHUB_APP_SLUG,
        publicBaseUrl: "http://localhost:8080",
      });
    });

    it("rejects a partial configuration, naming each missing variable without values", () => {
      const err = (() => {
        try {
          parseEnv({ ...valid, GITHUB_APP_CLIENT_ID: github.GITHUB_APP_CLIENT_ID });
        } catch (e) {
          return e as ConfigValidationError;
        }
        throw new Error("expected parseEnv to throw");
      })();
      expect(err.problems.map((p) => p.split(":")[0])).toEqual([
        "GITHUB_APP_CLIENT_SECRET",
        "GITHUB_APP_SLUG",
        "PUBLIC_BASE_URL",
      ]);
      expect(err.message).not.toContain(github.GITHUB_APP_CLIENT_ID);
    });

    it("rejects a public base URL with a path", () => {
      const problems = problemsFor({ ...valid, ...github, PUBLIC_BASE_URL: "https://x.dev/app" });
      expect(problems[0]).toMatch(/^PUBLIC_BASE_URL: /);
    });

    it("defaults the session lifetime to 8 hours and bounds it to 1-24", () => {
      expect(parseEnv(valid).sessionTtlHours).toBe(8);
      expect(problemsFor({ ...valid, SESSION_TTL_HOURS: "25" })[0]).toMatch(/^SESSION_TTL_HOURS: /);
    });
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
