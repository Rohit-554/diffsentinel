import { type ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { type AuthenticatedRequest, SessionGuard, UNAUTHENTICATED_BODY } from "./session.guard";
import type { ActiveSession, SessionService } from "./session.service";

function contextFor(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guardWith(result: ActiveSession | null) {
  const resolve = jest.fn<Promise<ActiveSession | null>, [string | undefined]>(() =>
    Promise.resolve(result),
  );
  return { guard: new SessionGuard({ resolve } as unknown as SessionService), resolve };
}

describe("SessionGuard", () => {
  it("attaches the session for a valid cookie", async () => {
    const session = { sessionId: "s1", userId: "u1" };
    const { guard, resolve } = guardWith(session);
    const request: AuthenticatedRequest = { headers: { cookie: "other=1; ds_session=tok" } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(resolve).toHaveBeenCalledWith("tok");
    expect(request.auth).toEqual(session);
  });

  it("rejects a request without a session cookie with a fixed 401 body", async () => {
    const { guard, resolve } = guardWith(null);
    const request: AuthenticatedRequest = { headers: {} };

    const err = await guard.canActivate(contextFor(request)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getResponse()).toEqual(UNAUTHENTICATED_BODY);
    expect(resolve).toHaveBeenCalledWith(undefined);
    expect(request.auth).toBeUndefined();
  });

  it("rejects a cookie that resolves to no session", async () => {
    const { guard } = guardWith(null);
    await expect(
      guard.canActivate(contextFor({ headers: { cookie: "ds_session=forged" } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
