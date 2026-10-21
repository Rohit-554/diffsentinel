import type { INestApplication, LoggerService } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Redis } from "ioredis";
import type { App } from "supertest/types";
import { REDIS_CLIENT } from "../../src/infra/redis.service";
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/app.setup";
import type { AppConfig, GitHubConfig } from "../../src/config/env";
import type { FetchFn } from "../../src/github/github-http";
import { GitHubOAuthClient } from "../../src/github/github-oauth.client";
import { GitHubUserClient } from "../../src/github/github-user.client";
import { GITHUB_OAUTH_CLIENT, GITHUB_USER_CLIENT } from "../../src/github/github.module";
import { testDatabaseUrl, testRedisUrl } from "./test-env";

export const TEST_GITHUB: GitHubConfig = {
  clientId: "Iv23liTestClient",
  clientSecret: "test-client-secret",
  appSlug: "diffsentinel-test",
  publicBaseUrl: "http://localhost:8080",
};

export interface TestAppOptions {
  /** false runs with GitHub sign-in not configured. Default: true. */
  github?: boolean;
  /** Base URL of a fake GitHub serving both the web (OAuth) and REST endpoints. */
  githubBaseUrl?: string;
  fetchFn?: FetchFn;
  /** Receives everything the app logs. Default: logging off. */
  logger?: LoggerService;
}

/** The real application module wired to the test database, test Redis and a fake GitHub. */
export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication<App>> {
  const github = options.github === false ? null : TEST_GITHUB;
  const config: AppConfig = {
    nodeEnv: "test",
    port: 0,
    logLevels: ["fatal"],
    databaseUrl: testDatabaseUrl,
    redisUrl: testRedisUrl,
    github,
    sessionTtlHours: 8,
  };
  const baseUrl = options.githubBaseUrl ?? "http://127.0.0.1:9";
  const fetchFn = options.fetchFn ?? fetch;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(config)] })
    .overrideProvider(GITHUB_OAUTH_CLIENT)
    .useValue(
      github ? new GitHubOAuthClient(github.clientId, github.clientSecret, fetchFn, baseUrl) : null,
    )
    .overrideProvider(GITHUB_USER_CLIENT)
    .useValue(new GitHubUserClient(fetchFn, baseUrl))
    .compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>({
    logger: options.logger ?? false,
  });
  configureApp(app);
  await app.init();

  // The client fails commands while connecting (no offline queue), so wait until it's ready.
  const redis = app.get<Redis>(REDIS_CLIENT);
  if (redis.status !== "ready") {
    await new Promise<void>((resolve) => redis.once("ready", () => resolve()));
  }
  return app;
}

/** Records every log line, for asserting that secrets never reach the logs. */
export class CapturingLogger implements LoggerService {
  readonly lines: string[] = [];
  private record = (...args: unknown[]) => {
    this.lines.push(
      args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(" "),
    );
  };
  log = this.record;
  error = this.record;
  warn = this.record;
  debug = this.record;
  verbose = this.record;
  fatal = this.record;
}

/** Parses Set-Cookie headers into name → { value, attributes }. */
export function setCookies(
  header: string | string[] | undefined,
): Map<string, { value: string; attributes: string[] }> {
  const result = new Map<string, { value: string; attributes: string[] }>();
  for (const line of Array.isArray(header) ? header : header ? [header] : []) {
    const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
    const eq = pair.indexOf("=");
    result.set(pair.slice(0, eq), { value: pair.slice(eq + 1), attributes });
  }
  return result;
}
