import type { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import type { App } from "supertest/types";
import { AuditService } from "../../src/audit/audit.service";
import { InstallationSyncService } from "../../src/installations/installation-sync.service";
import { createTestApp } from "./app";
import { FakeGitHubUsers, installation, repo } from "./fake-github";
import { signedInAs } from "./sessions-helper";
import { resetDatabase, testDatabaseUrl } from "./test-env";

/**
 * Every tenant-scoped endpoint, exercised as a member, a non-member and an
 * unauthenticated client. Tenants are created through the real sync:
 * - X and Y are members of installation "acme"; only X can see private repo 2.
 * - Z is a member of installation "globex" only.
 */
const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
const github = new FakeGitHubUsers();
const sync = new InstallationSyncService(prisma, github, new AuditService(prisma));
const noop = () => Promise.resolve(undefined);
let app: INestApplication<App>;

let acmeId: string;
let cookies: Record<"x" | "y" | "z", string>;

beforeAll(async () => {
  app = await createTestApp();
});

beforeEach(async () => {
  await resetDatabase(prisma);
  github.accounts.set("x", {
    user: { id: 1, login: "xavier", name: null },
    installations: [installation(100, "acme")],
    repositories: { 100: [repo(1), repo(2, true)] },
  });
  github.accounts.set("y", {
    user: { id: 2, login: "yolanda", name: null },
    installations: [installation(100, "acme")],
    repositories: { 100: [repo(1)] },
  });
  github.accounts.set("z", {
    user: { id: 3, login: "zed", name: null },
    installations: [installation(200, "globex")],
    repositories: { 200: [repo(9)] },
  });
  for (const token of ["x", "y", "z"]) await sync.run(token, noop);

  acmeId = (await prisma.installation.findUniqueOrThrow({ where: { githubInstallationId: 100n } }))
    .id;
  cookies = {
    x: (await signedInAs(prisma, 1, "xavier")).cookie,
    y: (await signedInAs(prisma, 2, "yolanda")).cookie,
    z: (await signedInAs(prisma, 3, "zed")).cookie,
  };
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const get = (path: string, cookie?: string) => {
  const req = request(app.getHttpServer()).get(path);
  return cookie ? req.set("Cookie", cookie) : req;
};

/** The `items` of a list response, typed for assertions. */
const items = <T = { fullName: string }>(res: { body: unknown }): T[] =>
  (res.body as { items: T[] }).items;

const NOT_FOUND = { error: "not_found", message: "Not found." };

describe("tenant access", () => {
  const endpoints = () => [
    "/api/v1/installations",
    "/api/v1/installations/install-url",
    "/api/v1/repositories",
    `/api/v1/repositories?installationId=${acmeId}`,
  ];

  it("rejects every tenant-scoped endpoint without a session", async () => {
    for (const path of endpoints()) {
      const res = await get(path);
      expect([path, res.status]).toEqual([path, 401]);
      expect(res.body).toEqual({ error: "unauthenticated", message: "Sign in to continue." });
    }
  });

  it("serves every tenant-scoped endpoint to a member", async () => {
    for (const path of endpoints()) {
      expect([path, (await get(path, cookies.x)).status]).toEqual([path, 200]);
    }
  });

  it("gives a non-member no data from another tenant", async () => {
    const installations = await get("/api/v1/installations", cookies.z).expect(200);
    expect(installations.body).toEqual({
      truncated: false,
      items: [expect.objectContaining({ accountLogin: "globex" })],
    });

    const repositories = await get("/api/v1/repositories", cookies.z).expect(200);
    expect(items(repositories)).toEqual([expect.objectContaining({ fullName: "acme/repo-9" })]);
    expect(JSON.stringify(repositories.body)).not.toContain(acmeId);

    const filtered = await get(`/api/v1/repositories?installationId=${acmeId}`, cookies.z);
    expect(filtered.status).toBe(404);
    expect(filtered.body).toEqual(NOT_FOUND);
  });

  it("answers 'not yours' exactly like 'doesn't exist'", async () => {
    const notYours = await get(`/api/v1/repositories?installationId=${acmeId}`, cookies.z);
    const missing = await get(
      "/api/v1/repositories?installationId=6f1d3c1e-0000-4000-8000-000000000000",
      cookies.z,
    );
    expect(notYours.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(notYours.text).toBe(missing.text);
  });

  it("rejects a malformed installation id with 400", async () => {
    const res = await get("/api/v1/repositories?installationId=1%20OR%201=1", cookies.x);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "invalid_request",
      message: "The request parameters are invalid.",
    });
  });

  it("shows members of a shared installation only their own repositories", async () => {
    const x = await get("/api/v1/repositories", cookies.x).expect(200);
    const y = await get("/api/v1/repositories", cookies.y).expect(200);
    expect(items(x).map((r) => r.fullName)).toEqual(["acme/repo-1", "acme/repo-2"]);
    expect(items(y).map((r) => r.fullName)).toEqual(["acme/repo-1"]);

    const yInstallations = await get("/api/v1/installations", cookies.y).expect(200);
    expect(items(yInstallations)).toEqual([
      {
        id: acmeId,
        accountLogin: "acme",
        accountType: "Organization",
        status: "active",
        repositoryCount: 1,
        repositoriesTruncated: false,
      },
    ]);
  });

  it("revokes access in already-open sessions when a sync removes the membership", async () => {
    const secondSession = (await signedInAs(prisma, 1, "xavier")).cookie;
    const account = github.accounts.get("x")!;
    account.installations = [];
    account.repositories = {};

    await sync.run("x", noop);

    for (const cookie of [cookies.x, secondSession]) {
      expect(items(await get("/api/v1/installations", cookie).expect(200))).toEqual([]);
      expect(items(await get("/api/v1/repositories", cookie).expect(200))).toEqual([]);
      await get(`/api/v1/repositories?installationId=${acmeId}`, cookie).expect(404);
    }
    // Y keeps access to the shared installation.
    expect(items(await get("/api/v1/repositories", cookies.y))).toHaveLength(1);
  });

  it("returns the App's install URL", async () => {
    const res = await get("/api/v1/installations/install-url", cookies.x).expect(200);
    expect(res.body).toEqual({
      url: "https://github.com/apps/diffsentinel-test/installations/new",
    });
  });

  it("documents the new routes in OpenAPI", async () => {
    const res = await get("/api/docs-json").expect(200);
    const paths = Object.keys((res.body as { paths: Record<string, unknown> }).paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/api/v1/auth/github/start",
        "/api/v1/auth/logout",
        "/api/v1/me",
        "/api/v1/installations",
        "/api/v1/installations/install-url",
        "/api/v1/repositories",
      ]),
    );
    // The callback carries secrets in its query and is deliberately undocumented.
    expect(paths).not.toContain("/api/v1/auth/github/callback");
  });
});
