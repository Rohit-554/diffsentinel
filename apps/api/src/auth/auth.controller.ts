import {
  Controller,
  Get,
  Inject,
  Logger,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ApiExcludeEndpoint,
  ApiFoundResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Request, Response } from "express";
import { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig, GitHubConfig } from "../config/env";
import { GitHubUnavailableError } from "../github/github-http";
import type { GitHubOAuthClient } from "../github/github-oauth.client";
import { GITHUB_OAUTH_CLIENT } from "../github/github.module";
import { InstallationSyncService } from "../installations/installation-sync.service";
import {
  clearPendingSignInCookieOptions,
  parseCookies,
  PENDING_SIGN_IN_COOKIE,
  pendingSignInCookieOptions,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "./cookies";
import { createPkcePair, randomToken, safeEqual } from "./crypto";
import { type PendingSignIn, PendingSignInStore } from "./pending-sign-in.store";
import { SessionService } from "./session.service";

export const CALLBACK_PATH = "/api/v1/auth/github/callback";
const DASHBOARD_PATH = "/dashboard";

/** Where the browser lands after a sign-in attempt that didn't succeed. */
export type SignInFailure = "failed" | "cancelled" | "unavailable";

/** Fixed reason categories recorded in `auth.sign_in_failed` audit events. */
type FailureReason =
  | "cancelled"
  | "state_mismatch"
  | "oauth_error"
  | "github_unavailable"
  | "store_unavailable"
  | "internal_error";

export const NOT_CONFIGURED_BODY = {
  error: "github_not_configured",
  message: "GitHub sign-in is not configured.",
} as const;

const callbackQuery = z.object({
  code: z.string().min(1).max(512),
  state: z.string().min(1).max(512),
});

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(GITHUB_OAUTH_CLIENT) private readonly oauth: GitHubOAuthClient | null,
    private readonly pending: PendingSignInStore,
    private readonly sessions: SessionService,
    private readonly sync: InstallationSyncService,
    private readonly audit: AuditService,
  ) {}

  @Get("github/start")
  @ApiOperation({ summary: "Start signing in with GitHub (redirects to GitHub)." })
  @ApiFoundResponse({ description: "Redirect to GitHub's authorization page." })
  @ApiServiceUnavailableResponse({ description: "GitHub sign-in is not configured." })
  async start(@Res() res: Response): Promise<void> {
    const { github, oauth } = this.requireGitHub();

    const state = randomToken();
    const { verifier, challenge } = createPkcePair();
    let pendingId: string;
    try {
      pendingId = await this.pending.create({ state, codeVerifier: verifier });
    } catch (err) {
      this.logger.warn(`Could not store pending sign-in (${errorName(err)})`);
      return failRedirect(res, "unavailable");
    }

    res.cookie(PENDING_SIGN_IN_COOKIE, pendingId, pendingSignInCookieOptions(github.publicBaseUrl));
    res.redirect(
      302,
      oauth.authorizeUrl({
        redirectUri: github.publicBaseUrl + CALLBACK_PATH,
        state,
        codeChallenge: challenge,
      }),
    );
  }

  /**
   * GitHub redirects here with `code` and `state`. The query carries secrets,
   * so nothing from it is logged, audited or echoed back.
   */
  @Get("github/callback")
  @ApiExcludeEndpoint()
  async callback(
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { github, oauth } = this.requireGitHub();
    const publicBaseUrl = github.publicBaseUrl;

    // Single use: consume the pending sign-in before anything else, whatever happens next.
    const pendingId = parseCookies(req.headers.cookie).get(PENDING_SIGN_IN_COOKIE);
    res.clearCookie(PENDING_SIGN_IN_COOKIE, clearPendingSignInCookieOptions(publicBaseUrl));
    let pending: PendingSignIn | null;
    try {
      pending = pendingId ? await this.pending.consume(pendingId) : null;
    } catch (err) {
      this.logger.warn(`Could not read pending sign-in (${errorName(err)})`);
      return this.fail(res, "unavailable", "store_unavailable");
    }

    if (query.error === "access_denied") {
      return this.fail(res, "cancelled", "cancelled");
    }

    const params = callbackQuery.safeParse(query);
    if (!pending || !params.success || !safeEqual(params.data.state, pending.state)) {
      return this.fail(res, "failed", "state_mismatch");
    }

    let accessToken: string;
    try {
      accessToken = await oauth.exchangeCode({
        code: params.data.code,
        codeVerifier: pending.codeVerifier,
        redirectUri: publicBaseUrl + CALLBACK_PATH,
      });
    } catch (err) {
      return this.failFromError(res, err);
    }

    let session: { token: string };
    try {
      ({ result: session } = await this.sync.run(accessToken, async (tx, userId) => {
        await this.audit.record(
          { action: "auth.sign_in", actorUserId: userId, resourceType: "user", resourceId: userId },
          tx,
        );
        return this.sessions.create(userId, tx);
      }));
    } catch (err) {
      return this.failFromError(res, err);
    }

    res.cookie(
      SESSION_COOKIE,
      session.token,
      sessionCookieOptions(publicBaseUrl, this.config.sessionTtlHours),
    );
    res.redirect(302, DASHBOARD_PATH);

    // Housekeeping after the response; failures here don't affect the sign-in.
    this.sessions.purgeExpired().catch((err: unknown) => {
      this.logger.warn(`Could not purge expired sessions (${errorName(err)})`);
    });
  }

  private requireGitHub(): { github: GitHubConfig; oauth: GitHubOAuthClient } {
    if (!this.config.github || !this.oauth) {
      throw new ServiceUnavailableException(NOT_CONFIGURED_BODY);
    }
    return { github: this.config.github, oauth: this.oauth };
  }

  private async failFromError(res: Response, err: unknown): Promise<void> {
    if (err instanceof GitHubUnavailableError) {
      this.logger.warn(`Sign-in failed: ${err.message}`);
      return err.category === "oauth_error"
        ? this.fail(res, "failed", "oauth_error")
        : this.fail(res, "unavailable", "github_unavailable");
    }
    this.logger.error(`Sign-in failed unexpectedly (${errorName(err)})`);
    return this.fail(res, "failed", "internal_error");
  }

  private async fail(res: Response, page: SignInFailure, reason: FailureReason): Promise<void> {
    try {
      await this.audit.record({ action: "auth.sign_in_failed", metadata: { reason } });
    } catch (err) {
      this.logger.warn(`Could not audit failed sign-in (${errorName(err)})`);
    }
    failRedirect(res, page);
  }
}

/** Redirects to the landing page with a fixed reason; never echoes request input. */
export function failRedirect(res: Response, reason: SignInFailure): void {
  res.redirect(302, `/?signin=${reason}`);
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown";
}
