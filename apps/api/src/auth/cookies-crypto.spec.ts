import { createHash } from "node:crypto";
import {
  parseCookies,
  pendingSignInCookieOptions,
  sessionCookieOptions,
  clearSessionCookieOptions,
} from "./cookies";
import { createPkcePair, pkceChallenge, randomToken, safeEqual, sha256 } from "./crypto";

describe("parseCookies", () => {
  it("returns an empty map without a header", () => {
    expect(parseCookies(undefined).size).toBe(0);
    expect(parseCookies("").size).toBe(0);
  });

  it("parses pairs, trims whitespace and decodes values", () => {
    const cookies = parseCookies(' ds_session=abc ; theme=dark%20mode;quoted="x y"');
    expect(Object.fromEntries(cookies)).toEqual({
      ds_session: "abc",
      theme: "dark mode",
      quoted: "x y",
    });
  });

  it("keeps the first value of a repeated name", () => {
    expect(parseCookies("a=1; a=2").get("a")).toBe("1");
  });

  it("keeps values containing '='", () => {
    expect(parseCookies("t=abc==").get("t")).toBe("abc==");
  });

  it("skips malformed pairs and keeps undecodable values raw", () => {
    const cookies = parseCookies("novalue; =x; bad=%E0%A4%A; ok=1");
    expect(Object.fromEntries(cookies)).toEqual({ bad: "%E0%A4%A", ok: "1" });
  });

  it("is not affected by prototype-like names", () => {
    const cookies = parseCookies("__proto__=x; constructor=y");
    expect(cookies.get("__proto__")).toBe("x");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe("cookie options", () => {
  it("marks cookies Secure only when the public URL uses https", () => {
    expect(sessionCookieOptions("https://diffsentinel.dev", 8).secure).toBe(true);
    expect(sessionCookieOptions("http://localhost:8080", 8).secure).toBe(false);
  });

  it("makes the session cookie HttpOnly, SameSite=Lax, site-wide and TTL-bound", () => {
    expect(sessionCookieOptions("http://localhost:8080", 8)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 8 * 3_600_000,
    });
    expect(clearSessionCookieOptions("http://localhost:8080").path).toBe("/");
  });

  it("scopes the pending sign-in cookie to the auth routes for 10 minutes", () => {
    expect(pendingSignInCookieOptions("http://localhost:8080")).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/api/v1/auth/github",
      maxAge: 600_000,
    });
  });
});

describe("crypto helpers", () => {
  it("generates distinct 256-bit URL-safe tokens", () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });

  it("derives the PKCE challenge as base64url(SHA-256(verifier))", () => {
    // Example from RFC 7636, appendix B.
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
    const { verifier, challenge } = createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("compares strings of any length", () => {
    expect(safeEqual("state-1", "state-1")).toBe(true);
    expect(safeEqual("state-1", "state-2")).toBe(false);
    expect(safeEqual("short", "a-much-longer-value")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });

  it("hashes to 32 bytes", () => {
    expect(sha256("x")).toHaveLength(32);
  });
});
