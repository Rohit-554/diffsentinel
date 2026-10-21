import { z } from "zod";
import { type FetchFn, GitHubUnavailableError, requestJson } from "./github-http";

export const GITHUB_WEB_BASE_URL = "https://github.com";

export interface AuthorizeParams {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

export interface ExchangeParams {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

// GitHub answers token-exchange errors with HTTP 200 and an "error" field.
const tokenResponse = z.union([
  z.object({ access_token: z.string().min(1), token_type: z.string() }),
  z.object({ error: z.string() }),
]);

/** The GitHub App's user-authorization (OAuth web flow) endpoints, with PKCE. */
export class GitHubOAuthClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly webBaseUrl: string = GITHUB_WEB_BASE_URL,
  ) {}

  authorizeUrl({ redirectUri, state, codeChallenge }: AuthorizeParams): string {
    const url = new URL("/login/oauth/authorize", this.webBaseUrl);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      allow_signup: "true",
    }).toString();
    return url.toString();
  }

  /** Exchanges an authorization code for a user access token. The token must not be stored. */
  async exchangeCode({ code, codeVerifier, redirectUri }: ExchangeParams): Promise<string> {
    const body = await requestJson(
      this.fetchFn,
      new URL("/login/oauth/access_token", this.webBaseUrl).toString(),
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "DiffSentinel",
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
        }).toString(),
      },
      tokenResponse,
    );
    if ("error" in body) throw new GitHubUnavailableError("oauth_error");
    return body.access_token;
  }
}
