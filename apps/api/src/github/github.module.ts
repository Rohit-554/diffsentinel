import { Module } from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/env";
import { GitHubOAuthClient } from "./github-oauth.client";
import { GitHubUserClient } from "./github-user.client";

/** GitHubOAuthClient, or null when GitHub sign-in is not configured. */
export const GITHUB_OAUTH_CLIENT = Symbol("GITHUB_OAUTH_CLIENT");
export const GITHUB_USER_CLIENT = Symbol("GITHUB_USER_CLIENT");

@Module({
  providers: [
    {
      provide: GITHUB_OAUTH_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.github
          ? new GitHubOAuthClient(config.github.clientId, config.github.clientSecret)
          : null,
    },
    { provide: GITHUB_USER_CLIENT, useFactory: () => new GitHubUserClient() },
  ],
  exports: [GITHUB_OAUTH_CLIENT, GITHUB_USER_CLIENT],
})
export class GitHubModule {}
