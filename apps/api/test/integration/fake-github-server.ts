import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { pkceChallenge } from "../../src/auth/crypto";
import type { FakeAccount } from "./fake-github";

interface IssuedCode {
  codeChallenge: string;
  accessToken: string;
}

/**
 * A local HTTP stand-in for github.com (OAuth) and api.github.com (REST).
 * Codes must be registered with the PKCE challenge the app sent, and the
 * exchange succeeds only with the matching verifier, as on GitHub.
 */
export class FakeGitHubServer {
  readonly accounts = new Map<string, FakeAccount>();
  private readonly codes = new Map<string, IssuedCode>();
  /** Makes GET /user return a body without an id. */
  brokenProfile = false;
  private server: Server | undefined;

  baseUrl = "";

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch(() => send(res, 500, { message: "fake failure" }));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }

  /** Simulates GitHub issuing `code` after the user approved an authorize request. */
  issueCode(code: string, codeChallenge: string, accessToken: string): void {
    this.codes.set(code, { codeChallenge, accessToken });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.baseUrl);

    if (req.method === "POST" && url.pathname === "/login/oauth/access_token") {
      const form = new URLSearchParams(await readBody(req));
      const issued = this.codes.get(form.get("code") ?? "");
      this.codes.delete(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      if (!issued || pkceChallenge(verifier) !== issued.codeChallenge) {
        return send(res, 200, { error: "bad_verification_code" });
      }
      return send(res, 200, { access_token: issued.accessToken, token_type: "bearer" });
    }

    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const account = this.accounts.get(token);
    if (!account) return send(res, 401, { message: "Bad credentials" });

    if (url.pathname === "/user") {
      const { id, login, name } = account.user;
      return send(res, 200, this.brokenProfile ? { login } : { id, login, name });
    }
    if (url.pathname === "/user/installations") {
      const items = page(account.installations, url).map((i) => ({
        id: i.id,
        account: i.account,
        suspended_at: i.suspended ? "2026-10-01T00:00:00Z" : null,
      }));
      return send(res, 200, { total_count: account.installations.length, installations: items });
    }
    const match = /^\/user\/installations\/(\d+)\/repositories$/.exec(url.pathname);
    if (match) {
      const all = account.repositories[Number(match[1])] ?? [];
      const items = page(all, url).map((r) => ({
        id: r.id,
        full_name: r.fullName,
        default_branch: r.defaultBranch,
        private: r.private,
      }));
      return send(res, 200, { total_count: all.length, repositories: items });
    }
    return send(res, 404, { message: "Not Found" });
  }
}

function page<T>(items: T[], url: URL): T[] {
  const perPage = Number(url.searchParams.get("per_page") ?? 30);
  const pageNumber = Number(url.searchParams.get("page") ?? 1);
  return items.slice((pageNumber - 1) * perPage, pageNumber * perPage);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
