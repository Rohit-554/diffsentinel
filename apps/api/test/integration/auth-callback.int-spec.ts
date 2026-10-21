import type { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import request from "supertest";
import type { App } from "supertest/types";
import { sha256 } from "../../src/auth/crypto";
import { hashToken } from "../../src/auth/session.service";
import type { FetchFn } from "../../src/github/github-http";
import { CapturingLogger, createTestApp, setCookies } from "./app";
import { installation, repo } from "./fake-github";
import { FakeGitHubServer } from "./fake-github-server";
import { resetDatabase, testDatabaseUrl, testRedisUrl } from "./test-env";

const ACCESS_TOKEN = "ghu_FakeAccessToken0000000000000000";

const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
const redis = new Redis(testRedisUrl);
const github = new FakeGitHubServer();
const logger = new CapturingLogger();
let app: INestApplication<App>;
let tokenEndpoint: "normal" | "timeout" = "normal";

const fetchWithFaults: FetchFn = (input, init) => {
  const url = input instanceof Request ? input.url : input.toString();
  if (tokenEndpoint === "timeout" && url.includes("/login/oauth/access_token")) {
    return Promise.reject(new DOMException("timed out", "TimeoutError"));
  }
  return fetch(input, init);
};

interface Started {
  cookie: string;
  pendingId: string;
  state: string;
  challenge: string;
}

/** Runs GET /start and returns what the browser and GitHub would see. */
async function startSignIn(): Promise<Started> {
  const res = await request(app.getHttpServer()).get("/api/v1/auth/github/start").expect(302);
  const params = new URL(res.headers.location as string).searchParams;
  const pendingId = setCookies(res.headers["set-cookie"]).get("ds_oauth")!.value;
  return {
    cookie: `ds_oauth=${pendingId}`,
    pendingId,
    state: params.get("state")!,
    challenge: params.get("code_challenge")!,
  };
}

/** Simulates the user approving on GitHub and GitHub redirecting back. */
async function approve(started: Started, code = "code-1") {
  github.issueCode(code, started.challenge, ACCESS_TOKEN);
  return request(app.getHttpServer())
    .get("/api/v1/auth/github/callback")
    .query({ code, state: started.state })
    .set("Cookie", started.cookie);
}

beforeAll(async () => {
  await github.start();
  app = await createTestApp({ githubBaseUrl: github.baseUrl, fetchFn: fetchWithFaults, logger });
});

beforeEach(async () => {
  await resetDatabase(prisma);
  tokenEndpoint = "normal";
  github.brokenProfile = false;
  github.accounts.set(ACCESS_TOKEN, {
    user: { id: 7, login: "octocat", name: "The Octocat" },
    installations: [installation(100)],
    repositories: { 100: [repo(1), repo(2, true)] },
  });
});

afterAll(async () => {
  await app.close();
  await github.stop();
  await redis.quit();
  await prisma.$disconnect();
});

async function expectNoSession() {
  expect(await prisma.session.count()).toBe(0);
}

async function lastFailureReason(): Promise<unknown> {
  const event = await prisma.auditEvent.findFirst({
    where: { action: "auth.sign_in_failed" },
    orderBy: { occurredAt: "desc" },
  });
  return (event?.metadata as { reason?: string } | undefined)?.reason;
}

describe("GET /api/v1/auth/github/callback", () => {
  it("signs the user in, syncs installations and redirects to the dashboard", async () => {
    const res = await approve(await startSignIn());

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/dashboard");

    const cookies = setCookies(res.headers["set-cookie"]);
    const session = cookies.get("ds_session");
    expect(session?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session?.attributes).toEqual(
      expect.arrayContaining(["Max-Age=28800", "Path=/", "HttpOnly", "SameSite=Lax"]),
    );
    expect(cookies.get("ds_oauth")?.value).toBe("");

    const user = await prisma.user.findUniqueOrThrow({ where: { githubUserId: 7n } });
    expect(user).toMatchObject({ login: "octocat", displayName: "The Octocat" });
    expect(
      await prisma.session.count({
        where: { userId: user.id, tokenHash: hashToken(session!.value) },
      }),
    ).toBe(1);
    expect(await prisma.repositoryAccess.count({ where: { userId: user.id } })).toBe(2);
    expect(
      await prisma.auditEvent.count({ where: { action: "auth.sign_in", actorUserId: user.id } }),
    ).toBe(1);
  });

  it("never stores the GitHub access token", async () => {
    await approve(await startSignIn());
    const [dump] = await prisma.$queryRaw<{ dump: string }[]>`
      SELECT concat_ws(' ',
        (SELECT string_agg(u::text, ' ') FROM users u),
        (SELECT string_agg(s::text, ' ') FROM sessions s),
        (SELECT string_agg(a::text, ' ') FROM audit_events a)) AS dump`;
    expect(dump?.dump).not.toContain(ACCESS_TOKEN);
  });

  it("refuses a state that doesn't match the pending sign-in", async () => {
    const started = await startSignIn();
    const res = await approve({ ...started, state: "forged-state" });

    expect(res.headers.location).toBe("/?signin=failed");
    await expectNoSession();
    expect(await lastFailureReason()).toBe("state_mismatch");
  });

  it("refuses a callback without the pending sign-in cookie", async () => {
    const res = await approve({ ...(await startSignIn()), cookie: "" });
    expect(res.headers.location).toBe("/?signin=failed");
    await expectNoSession();
  });

  it("refuses an expired pending sign-in", async () => {
    const started = await startSignIn();
    await redis.del(`auth:pending:${sha256(started.pendingId).toString("hex")}`);

    const res = await approve(started);
    expect(res.headers.location).toBe("/?signin=failed");
    await expectNoSession();
  });

  it("refuses a replayed callback", async () => {
    const started = await startSignIn();
    expect((await approve(started, "code-a")).headers.location).toBe("/dashboard");

    const replay = await approve(started, "code-b");
    expect(replay.headers.location).toBe("/?signin=failed");
    expect(await prisma.session.count()).toBe(1);
  });

  it("burns the pending sign-in even when the state is wrong", async () => {
    const started = await startSignIn();
    await approve({ ...started, state: "wrong" });
    const retry = await approve(started);
    expect(retry.headers.location).toBe("/?signin=failed");
    await expectNoSession();
  });

  it("reports a cancelled sign-in when the user denies access", async () => {
    const started = await startSignIn();
    const res = await request(app.getHttpServer())
      .get("/api/v1/auth/github/callback")
      .query({ error: "access_denied", state: started.state })
      .set("Cookie", started.cookie);

    expect(res.headers.location).toBe("/?signin=cancelled");
    expect(setCookies(res.headers["set-cookie"]).get("ds_oauth")?.value).toBe("");
    await expectNoSession();
    expect(await lastFailureReason()).toBe("cancelled");
  });

  it("refuses a code issued for a different PKCE challenge", async () => {
    const started = await startSignIn();
    const res = await approve({ ...started, challenge: "some-other-challenge" });
    expect(res.headers.location).toBe("/?signin=failed");
    expect(await lastFailureReason()).toBe("oauth_error");
  });

  it("reports GitHub as unavailable when the token exchange times out", async () => {
    tokenEndpoint = "timeout";
    const res = await approve(await startSignIn());

    expect(res.headers.location).toBe("/?signin=unavailable");
    await expectNoSession();
    expect(await lastFailureReason()).toBe("github_unavailable");
  });

  it("creates no user when GitHub returns a profile without an id", async () => {
    github.brokenProfile = true;
    const res = await approve(await startSignIn());

    expect(res.headers.location).toBe("/?signin=unavailable");
    expect(await prisma.user.count()).toBe(0);
    await expectNoSession();
  });

  it("never logs the code, state, verifier, access token or session", async () => {
    logger.lines.length = 0;
    const started = await startSignIn();
    const ok = await approve(started, "secret-code-123");
    tokenEndpoint = "timeout";
    const failedStart = await startSignIn();
    await approve(failedStart, "secret-code-456");

    const session = setCookies(ok.headers["set-cookie"]).get("ds_session")!.value;
    const logs = logger.lines.join("\n");
    expect(logger.lines.length).toBeGreaterThan(0);
    for (const secret of [
      "secret-code-123",
      "secret-code-456",
      started.state,
      started.pendingId,
      failedStart.state,
      ACCESS_TOKEN,
      session,
    ]) {
      expect(logs).not.toContain(secret);
    }
  });
});
