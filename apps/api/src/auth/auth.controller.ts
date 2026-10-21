import { Controller, Get, Inject, Logger, Res, ServiceUnavailableException } from "@nestjs/common";
import {
  ApiFoundResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig, GitHubConfig } from "../config/env";
import type { GitHubOAuthClient } from "../github/github-oauth.client";
import { GITHUB_OAUTH_CLIENT } from "../github/github.module";
import { PENDING_SIGN_IN_COOKIE, pendingSignInCookieOptions } from "./cookies";
import { createPkcePair, randomToken } from "./crypto";
import { PendingSignInStore } from "./pending-sign-in.store";

export const CALLBACK_PATH = "/api/v1/auth/github/callback";

/** Where the browser lands after a sign-in attempt that didn't succeed. */
export type SignInFailure = "failed" | "cancelled" | "unavailable";

export const NOT_CONFIGURED_BODY = {
  error: "github_not_configured",
  message: "GitHub sign-in is not configured.",
} as const;

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(GITHUB_OAUTH_CLIENT) private readonly oauth: GitHubOAuthClient | null,
    private readonly pending: PendingSignInStore,
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

  private requireGitHub(): { github: GitHubConfig; oauth: GitHubOAuthClient } {
    if (!this.config.github || !this.oauth) {
      throw new ServiceUnavailableException(NOT_CONFIGURED_BODY);
    }
    return { github: this.config.github, oauth: this.oauth };
  }
}

/** Redirects to the landing page with a fixed reason; never echoes request input. */
export function failRedirect(res: Response, reason: SignInFailure): void {
  res.redirect(302, `/?signin=${reason}`);
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown";
}
