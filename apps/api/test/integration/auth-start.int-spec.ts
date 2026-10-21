import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { App } from "supertest/types";
import { createTestApp, setCookies, TEST_GITHUB } from "./app";

describe("GET /api/v1/auth/github/start", () => {
  describe("when GitHub sign-in is configured", () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createTestApp({ githubBaseUrl: "https://github.example" });
    });

    afterAll(async () => {
      await app.close();
    });

    it("redirects to GitHub with client id, callback, state and an S256 challenge", async () => {
      const res = await request(app.getHttpServer()).get("/api/v1/auth/github/start").expect(302);

      const location = new URL(res.headers.location as string);
      expect(location.origin + location.pathname).toBe(
        "https://github.example/login/oauth/authorize",
      );
      const params = Object.fromEntries(location.searchParams);
      expect(params).toMatchObject({
        client_id: TEST_GITHUB.clientId,
        redirect_uri: "http://localhost:8080/api/v1/auth/github/callback",
        code_challenge_method: "S256",
      });
      expect(params.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(params.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(location.toString()).not.toContain(TEST_GITHUB.clientSecret);
    });

    it("sets an HttpOnly, SameSite=Lax pending cookie scoped to the auth routes for 10 minutes", async () => {
      const res = await request(app.getHttpServer()).get("/api/v1/auth/github/start").expect(302);

      const cookie = setCookies(res.headers["set-cookie"]).get("ds_oauth");
      expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(cookie?.attributes).toEqual(
        expect.arrayContaining([
          "Max-Age=600",
          "Path=/api/v1/auth/github",
          "HttpOnly",
          "SameSite=Lax",
        ]),
      );
      expect(cookie?.attributes).not.toContain("Secure");
    });

    it("uses a new state and challenge for every attempt", async () => {
      const server = app.getHttpServer();
      const [a, b] = await Promise.all([
        request(server).get("/api/v1/auth/github/start"),
        request(server).get("/api/v1/auth/github/start"),
      ]);
      const paramsA = new URL(a.headers.location as string).searchParams;
      const paramsB = new URL(b.headers.location as string).searchParams;
      expect(paramsA.get("state")).not.toBe(paramsB.get("state"));
      expect(paramsA.get("code_challenge")).not.toBe(paramsB.get("code_challenge"));
    });
  });

  describe("when GitHub sign-in is not configured", () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createTestApp({ github: false });
    });

    afterAll(async () => {
      await app.close();
    });

    it("responds 503 with a fixed message", async () => {
      const res = await request(app.getHttpServer()).get("/api/v1/auth/github/start").expect(503);
      expect(res.body).toEqual({
        error: "github_not_configured",
        message: "GitHub sign-in is not configured.",
      });
      expect(res.headers["set-cookie"]).toBeUndefined();
    });

    it("leaves the health endpoints working", async () => {
      await request(app.getHttpServer()).get("/api/v1/health/ready").expect(200);
    });
  });
});
