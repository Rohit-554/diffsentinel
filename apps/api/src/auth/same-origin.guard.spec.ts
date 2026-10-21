import { type ExecutionContext, ForbiddenException } from "@nestjs/common";
import { SameOriginGuard } from "./same-origin.guard";

const PUBLIC_ORIGIN = "http://localhost:8080";

function context(method: string, origin?: string): ExecutionContext {
  const request = { method, headers: origin === undefined ? {} : { origin } };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

const configured = new SameOriginGuard({
  github: {
    clientId: "id",
    clientSecret: "secret",
    appSlug: "slug",
    publicBaseUrl: PUBLIC_ORIGIN,
  },
});

describe("SameOriginGuard", () => {
  it("allows safe methods from any origin", () => {
    expect(configured.canActivate(context("GET", "https://evil.example"))).toBe(true);
  });

  it("allows a POST from the public origin", () => {
    expect(configured.canActivate(context("POST", PUBLIC_ORIGIN))).toBe(true);
  });

  it("allows a POST without an Origin header", () => {
    expect(configured.canActivate(context("POST"))).toBe(true);
  });

  it.each(["https://evil.example", "null", "http://localhost:8080.evil.example"])(
    "refuses a POST from %s",
    (origin) => {
      expect(() => configured.canActivate(context("POST", origin))).toThrow(ForbiddenException);
    },
  );

  it("refuses cross-origin mutations when no public origin is configured", () => {
    const unconfigured = new SameOriginGuard({ github: null });
    expect(() => unconfigured.canActivate(context("DELETE", "http://localhost:8080"))).toThrow(
      ForbiddenException,
    );
  });
});
