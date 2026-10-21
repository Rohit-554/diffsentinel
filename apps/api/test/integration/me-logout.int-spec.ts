import type { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import type { App } from "supertest/types";
import { hashToken } from "../../src/auth/session.service";
import { createTestApp, setCookies, TEST_GITHUB } from "./app";
import { signedInAs } from "./sessions-helper";
import { resetDatabase, testDatabaseUrl } from "./test-env";

const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
let app: INestApplication<App>;

beforeAll(async () => {
  app = await createTestApp();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const UNAUTHENTICATED = { error: "unauthenticated", message: "Sign in to continue." };

describe("GET /api/v1/me", () => {
  it("returns the signed-in user without any secrets", async () => {
    const { userId, cookie, token } = await signedInAs(prisma, 7, "octocat");

    const res = await request(app.getHttpServer())
      .get("/api/v1/me")
      .set("Cookie", cookie)
      .expect(200);

    expect(res.body).toEqual({ id: userId, login: "octocat", displayName: "OCTOCAT" });
    expect(JSON.stringify(res.body)).not.toContain(token);
  });

  it("responds 401 without a session", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/me").expect(401);
    expect(res.body).toEqual(UNAUTHENTICATED);
  });

  it("responds 401 for a forged session", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/me")
      .set("Cookie", "ds_session=forged")
      .expect(401);
  });

  it("responds 401 for an expired session", async () => {
    const { cookie, token } = await signedInAs(prisma, 7, "octocat");
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app.getHttpServer()).get("/api/v1/me").set("Cookie", cookie).expect(401);
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("revokes the session and clears the cookie", async () => {
    const { userId, cookie } = await signedInAs(prisma, 7, "octocat");
    const server = app.getHttpServer();

    const res = await request(server)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookie)
      .set("Origin", TEST_GITHUB.publicBaseUrl)
      .expect(204);

    const cleared = setCookies(res.headers["set-cookie"]).get("ds_session");
    expect(cleared?.value).toBe("");
    expect(cleared?.attributes).toEqual(expect.arrayContaining(["Path=/", "HttpOnly"]));
    await request(server).get("/api/v1/me").set("Cookie", cookie).expect(401);
    expect(
      await prisma.auditEvent.count({ where: { action: "auth.sign_out", actorUserId: userId } }),
    ).toBe(1);
  });

  it("refuses a cross-site sign-out and keeps the session", async () => {
    const { cookie } = await signedInAs(prisma, 7, "octocat");
    const server = app.getHttpServer();

    const res = await request(server)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookie)
      .set("Origin", "https://evil.example")
      .expect(403);

    expect(res.body).toEqual({
      error: "cross_origin_request",
      message: "Cross-site requests are not allowed.",
    });
    await request(server).get("/api/v1/me").set("Cookie", cookie).expect(200);
  });

  it("succeeds without a session", async () => {
    await request(app.getHttpServer()).post("/api/v1/auth/logout").expect(204);
    expect(await prisma.auditEvent.count()).toBe(0);
  });

  it("is not reachable with GET", async () => {
    const { cookie } = await signedInAs(prisma, 7, "octocat");
    const server = app.getHttpServer();
    await request(server).get("/api/v1/auth/logout").set("Cookie", cookie).expect(404);
    await request(server).get("/api/v1/me").set("Cookie", cookie).expect(200);
  });

  it("only revokes the session it was called with", async () => {
    const first = await signedInAs(prisma, 7, "octocat");
    const second = await signedInAs(prisma, 7, "octocat");
    const server = app.getHttpServer();

    await request(server).post("/api/v1/auth/logout").set("Cookie", first.cookie).expect(204);

    await request(server).get("/api/v1/me").set("Cookie", second.cookie).expect(200);
  });
});
