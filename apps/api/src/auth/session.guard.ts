import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiUnauthorizedResponse } from "@nestjs/swagger";
import { parseCookies, SESSION_COOKIE } from "./cookies";
import { type ActiveSession, SessionService } from "./session.service";

/** The request fields the guard reads and writes. */
export interface AuthenticatedRequest {
  headers: { cookie?: string | undefined };
  auth?: ActiveSession;
}

export const UNAUTHENTICATED_BODY = {
  error: "unauthenticated",
  message: "Sign in to continue.",
} as const;

/** Rejects requests without a valid session with 401 and attaches the session otherwise. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    const session = await this.sessions.resolve(token);
    if (!session) throw new UnauthorizedException(UNAUTHENTICATED_BODY);
    request.auth = session;
    return true;
  }
}

/** Requires a signed-in user for a route or controller. */
export const Authenticated = () =>
  applyDecorators(
    UseGuards(SessionGuard),
    ApiUnauthorizedResponse({ description: "No valid session." }),
  );

/** The session attached by SessionGuard; only valid on @Authenticated() routes. */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActiveSession => {
    const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth) throw new UnauthorizedException(UNAUTHENTICATED_BODY);
    return auth;
  },
);
