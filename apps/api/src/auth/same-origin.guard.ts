import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/env";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const CROSS_ORIGIN_BODY = {
  error: "cross_origin_request",
  message: "Cross-site requests are not allowed.",
} as const;

/**
 * CSRF defence for every state-changing request, alongside SameSite=Lax
 * cookies: a request whose Origin header is present and isn't PUBLIC_BASE_URL
 * is refused. Requests without Origin (non-browser clients) carry no
 * ambient browser credentials and are allowed through.
 */
@Injectable()
export class SameOriginGuard implements CanActivate {
  private readonly allowedOrigin: string | undefined;

  constructor(@Inject(APP_CONFIG) config: Pick<AppConfig, "github">) {
    this.allowedOrigin = config.github?.publicBaseUrl;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ method: string; headers: { origin?: string | undefined } }>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
    const origin = request.headers.origin;
    if (origin === undefined) return true;
    if (this.allowedOrigin !== undefined && origin === this.allowedOrigin) return true;
    throw new ForbiddenException(CROSS_ORIGIN_BODY);
  }
}
