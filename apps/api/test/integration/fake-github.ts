import type {
  Capped,
  GitHubInstallation,
  GitHubRepository,
  GitHubUser,
} from "../../src/github/github-user.client";
import { GitHubUnavailableError } from "../../src/github/github-http";
import type { UserReader } from "../../src/installations/installation-sync.service";

export interface FakeAccount {
  user: GitHubUser;
  installations: GitHubInstallation[];
  /** Repositories visible to this user, per GitHub installation id. */
  repositories: Record<number, GitHubRepository[]>;
}

export function repo(id: number, isPrivate = false): GitHubRepository {
  return { id, fullName: `acme/repo-${id}`, defaultBranch: "main", private: isPrivate };
}

export function installation(id: number, login = "acme", suspended = false): GitHubInstallation {
  return { id, account: { id: id * 10, login, type: "Organization" }, suspended };
}

/**
 * An in-memory GitHub keyed by token: each token is one user's view.
 * Tests mutate accounts between syncs to simulate changes on GitHub.
 */
export class FakeGitHubUsers implements UserReader {
  readonly accounts = new Map<string, FakeAccount>();
  /** GitHub installation ids whose repository listing fails. */
  readonly failingInstallations = new Set<number>();

  private account(token: string): FakeAccount {
    const account = this.accounts.get(token);
    if (!account) throw new GitHubUnavailableError("http_error", 401);
    return account;
  }

  getUser(token: string): Promise<GitHubUser> {
    return Promise.resolve(this.account(token).user);
  }

  listInstallations(token: string, cap: number): Promise<Capped<GitHubInstallation>> {
    const all = this.account(token).installations;
    return Promise.resolve({ items: all.slice(0, cap), truncated: all.length > cap });
  }

  listRepositories(
    token: string,
    installationId: number,
    cap: number,
  ): Promise<Capped<GitHubRepository>> {
    if (this.failingInstallations.has(installationId)) {
      return Promise.reject(new GitHubUnavailableError("timeout"));
    }
    const all = this.account(token).repositories[installationId] ?? [];
    return Promise.resolve({ items: all.slice(0, cap), truncated: all.length > cap });
  }
}
