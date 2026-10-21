import { z } from "zod";
import { type FetchFn, requestJson } from "./github-http";

export const GITHUB_API_BASE_URL = "https://api.github.com";
const MAX_PER_PAGE = 100;

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
}

export interface GitHubInstallation {
  id: number;
  account: { id: number; login: string; type: string };
  suspended: boolean;
}

export interface GitHubRepository {
  id: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

/** A capped listing; `truncated` means GitHub reported more items than were read. */
export interface Capped<T> {
  items: T[];
  truncated: boolean;
}

const userSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  name: z.string().nullable().optional(),
});

// Enterprise accounts have a slug and no login or type.
const installationSchema = z.object({
  id: z.number().int().positive(),
  account: z.object({
    id: z.number().int().positive(),
    login: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    type: z.string().optional(),
  }),
  suspended_at: z.string().nullable().optional(),
});

const repositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().min(1),
  default_branch: z.string().min(1),
  private: z.boolean(),
});

const installationsPage = z.object({
  total_count: z.number().int().nonnegative(),
  installations: z.array(installationSchema),
});

const repositoriesPage = z.object({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(repositorySchema),
});

/**
 * GitHub REST calls made with a user access token. Every call is bounded by a
 * timeout and validated; listings stop at a caller-supplied cap.
 */
export class GitHubUserClient {
  constructor(
    private readonly fetchFn: FetchFn = fetch,
    private readonly apiBaseUrl: string = GITHUB_API_BASE_URL,
  ) {}

  async getUser(token: string): Promise<GitHubUser> {
    const user = await this.get(token, "/user", userSchema);
    return { id: user.id, login: user.login, name: user.name ?? null };
  }

  async listInstallations(token: string, cap: number): Promise<Capped<GitHubInstallation>> {
    return this.listCapped(token, "/user/installations", cap, async (path) => {
      const page = await this.get(token, path, installationsPage);
      return {
        total: page.total_count,
        items: page.installations.map((i) => {
          const login = i.account.login ?? i.account.slug;
          if (login === undefined) {
            return null; // An account GitHub gave no name for; skip it rather than fail sign-in.
          }
          return {
            id: i.id,
            account: { id: i.account.id, login, type: i.account.type ?? "Enterprise" },
            suspended: Boolean(i.suspended_at),
          };
        }),
      };
    });
  }

  async listRepositories(
    token: string,
    installationId: number,
    cap: number,
  ): Promise<Capped<GitHubRepository>> {
    const base = `/user/installations/${installationId}/repositories`;
    return this.listCapped(token, base, cap, async (path) => {
      const page = await this.get(token, path, repositoriesPage);
      return {
        total: page.total_count,
        items: page.repositories.map((r) => ({
          id: r.id,
          fullName: r.full_name,
          defaultBranch: r.default_branch,
          private: r.private,
        })),
      };
    });
  }

  private async listCapped<T>(
    token: string,
    basePath: string,
    cap: number,
    fetchPage: (path: string) => Promise<{ total: number; items: (T | null)[] }>,
  ): Promise<Capped<T>> {
    const perPage = Math.min(MAX_PER_PAGE, cap);
    const maxPages = Math.ceil(cap / perPage);
    const items: T[] = [];
    let total = 0;
    for (let page = 1; page <= maxPages && items.length < cap; page++) {
      const result = await fetchPage(`${basePath}?per_page=${perPage}&page=${page}`);
      total = result.total;
      for (const item of result.items) {
        if (item !== null && items.length < cap) items.push(item);
      }
      if (result.items.length < perPage) break;
    }
    return { items, truncated: total > cap };
  }

  private get<S extends z.ZodType>(token: string, path: string, schema: S): Promise<z.infer<S>> {
    return requestJson(
      this.fetchFn,
      new URL(path, this.apiBaseUrl).toString(),
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "DiffSentinel",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      schema,
    );
  }
}
