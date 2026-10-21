import { type FetchFn, GitHubUnavailableError } from "./github-http";
import { GitHubOAuthClient } from "./github-oauth.client";
import { GitHubUserClient } from "./github-user.client";

const TOKEN = "ghu_FakeUserToken0123456789";
const SECRET = "client-secret-value-123";

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = jest.fn<Promise<Response>, Parameters<FetchFn>>(async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push({ url, init });
    return handler(url, init);
  });
  return { fetch: fn as unknown as FetchFn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function failure(promise: Promise<unknown>): Promise<GitHubUnavailableError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof GitHubUnavailableError) return err;
    throw err;
  }
  throw new Error("expected a GitHubUnavailableError");
}

function repo(id: number) {
  return { id, full_name: `acme/repo-${id}`, default_branch: "main", private: id % 2 === 0 };
}

describe("GitHubOAuthClient", () => {
  it("builds an authorize URL with state and an S256 PKCE challenge", () => {
    const client = new GitHubOAuthClient("Iv23liExample", SECRET);
    const url = new URL(
      client.authorizeUrl({
        redirectUri: "http://localhost:8080/api/v1/auth/github/callback",
        state: "state-123",
        codeChallenge: "challenge-abc",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "Iv23liExample",
      redirect_uri: "http://localhost:8080/api/v1/auth/github/callback",
      state: "state-123",
      code_challenge: "challenge-abc",
      code_challenge_method: "S256",
    });
    expect(url.toString()).not.toContain(SECRET);
  });

  it("exchanges a code with the PKCE verifier", async () => {
    const { fetch, calls } = fakeFetch(() => json({ access_token: TOKEN, token_type: "bearer" }));
    const client = new GitHubOAuthClient("Iv23liExample", SECRET, fetch);

    const token = await client.exchangeCode({
      code: "code-1",
      codeVerifier: "verifier-1",
      redirectUri: "http://localhost/cb",
    });

    expect(token).toBe(TOKEN);
    expect(calls[0]?.init.method).toBe("POST");
    const sent = new URLSearchParams(calls[0]?.init.body as string);
    expect(Object.fromEntries(sent)).toMatchObject({
      code: "code-1",
      code_verifier: "verifier-1",
      client_secret: SECRET,
    });
  });

  it("treats an OAuth error answered with HTTP 200 as a failure", async () => {
    const { fetch } = fakeFetch(() =>
      json({ error: "bad_verification_code", error_description: "The code is incorrect" }),
    );
    const client = new GitHubOAuthClient("id", SECRET, fetch);
    const err = await failure(
      client.exchangeCode({ code: "x", codeVerifier: "y", redirectUri: "http://l/cb" }),
    );
    expect(err.category).toBe("oauth_error");
    expect(err.message).not.toContain("incorrect");
  });
});

describe("GitHubUserClient", () => {
  it("reads the user with the token as a bearer credential and versioned headers", async () => {
    const { fetch, calls } = fakeFetch(() => json({ id: 42, login: "octocat", name: null }));
    const user = await new GitHubUserClient(fetch).getUser(TOKEN);

    expect(user).toEqual({ id: 42, login: "octocat", name: null });
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("x-github-api-version")).toBe("2022-11-28");
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps installations, including suspended and enterprise accounts", async () => {
    const { fetch } = fakeFetch(() =>
      json({
        total_count: 3,
        installations: [
          { id: 1, account: { id: 10, login: "octocat", type: "User" }, suspended_at: null },
          {
            id: 2,
            account: { id: 20, login: "acme", type: "Organization" },
            suspended_at: "2026-10-01T00:00:00Z",
          },
          { id: 3, account: { id: 30, slug: "big-corp" } },
        ],
      }),
    );
    const result = await new GitHubUserClient(fetch).listInstallations(TOKEN, 20);
    expect(result).toEqual({
      truncated: false,
      items: [
        { id: 1, account: { id: 10, login: "octocat", type: "User" }, suspended: false },
        { id: 2, account: { id: 20, login: "acme", type: "Organization" }, suspended: true },
        { id: 3, account: { id: 30, login: "big-corp", type: "Enterprise" }, suspended: false },
      ],
    });
  });

  it("pages through repositories 100 at a time and stops at the cap", async () => {
    const total = 450;
    const { fetch, calls } = fakeFetch((url) => {
      const page = Number(url.searchParams.get("page"));
      const perPage = Number(url.searchParams.get("per_page"));
      const ids = Array.from({ length: perPage }, (_, i) => (page - 1) * perPage + i + 1);
      return json({ total_count: total, repositories: ids.filter((id) => id <= total).map(repo) });
    });

    const result = await new GitHubUserClient(fetch).listRepositories(TOKEN, 7, 300);

    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.url.pathname === "/user/installations/7/repositories")).toBe(true);
    expect(calls.map((c) => c.url.searchParams.get("per_page"))).toEqual(["100", "100", "100"]);
    expect(result.items).toHaveLength(300);
    expect(result.truncated).toBe(true);
    expect(result.items[0]).toEqual({
      id: 1,
      fullName: "acme/repo-1",
      defaultBranch: "main",
      private: false,
    });
  });

  it("stops after a short page without marking the list truncated", async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({ total_count: 2, repositories: [repo(1), repo(2)] }),
    );
    const result = await new GitHubUserClient(fetch).listRepositories(TOKEN, 7, 300);
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ truncated: false });
    expect(result.items).toHaveLength(2);
  });

  it("asks for only as many installations as the cap allows", async () => {
    const { fetch, calls } = fakeFetch(() => json({ total_count: 25, installations: [] }));
    const result = await new GitHubUserClient(fetch).listInstallations(TOKEN, 20);
    expect(calls[0]?.url.searchParams.get("per_page")).toBe("20");
    expect(result.truncated).toBe(true);
  });

  describe("failures", () => {
    it("reports a timeout", async () => {
      const { fetch } = fakeFetch(() => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      });
      expect((await failure(new GitHubUserClient(fetch).getUser(TOKEN))).category).toBe("timeout");
    });

    it("reports an unreachable host", async () => {
      const { fetch } = fakeFetch(() => {
        throw new TypeError("fetch failed");
      });
      expect((await failure(new GitHubUserClient(fetch).getUser(TOKEN))).category).toBe(
        "unreachable",
      );
    });

    it("reports a non-2xx status without the body", async () => {
      const { fetch } = fakeFetch(() => json({ message: `Bad credentials ${TOKEN}` }, 401));
      const err = await failure(new GitHubUserClient(fetch).getUser(TOKEN));
      expect(err).toMatchObject({ category: "http_error", status: 401 });
      expect(err.message).toBe("GitHub request failed: http_error (HTTP 401)");
    });

    it("rejects a response that doesn't match the schema", async () => {
      const { fetch } = fakeFetch(() => json({ login: "no-id" }));
      expect((await failure(new GitHubUserClient(fetch).getUser(TOKEN))).category).toBe(
        "invalid_response",
      );
    });

    it("rejects a body that isn't JSON", async () => {
      const { fetch } = fakeFetch(() => new Response("<html>oops</html>", { status: 200 }));
      expect((await failure(new GitHubUserClient(fetch).getUser(TOKEN))).category).toBe(
        "invalid_response",
      );
    });

    it("never puts the token in the error", async () => {
      const { fetch } = fakeFetch(() => json({ message: TOKEN }, 500));
      const err = await failure(new GitHubUserClient(fetch).getUser(TOKEN));
      expect(`${err.message} ${JSON.stringify(err)} ${err.stack}`).not.toContain(TOKEN);
    });
  });
});
