import type { z } from "zod";

/** Why a GitHub call failed. Deliberately coarse: never carries response bodies. */
export type GitHubErrorCategory =
  "timeout" | "unreachable" | "http_error" | "invalid_response" | "oauth_error";

/**
 * Any failure talking to GitHub. The message names only the category and
 * HTTP status, so it is safe to log; tokens, codes and bodies never reach it.
 */
export class GitHubUnavailableError extends Error {
  override readonly name = "GitHubUnavailableError";

  constructor(
    readonly category: GitHubErrorCategory,
    readonly status?: number,
  ) {
    super(`GitHub request failed: ${category}${status === undefined ? "" : ` (HTTP ${status})`}`);
  }
}

export type FetchFn = typeof fetch;

export const GITHUB_TIMEOUT_MS = 10_000;

/** Sends one request and validates the JSON response; every failure becomes GitHubUnavailableError. */
export async function requestJson<S extends z.ZodType>(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  schema: S,
  timeoutMs = GITHUB_TIMEOUT_MS,
): Promise<z.infer<S>> {
  let response: Response;
  try {
    response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    // Check the name rather than instanceof: DOMException may come from another realm.
    const name = typeof err === "object" && err !== null && "name" in err ? err.name : "";
    throw new GitHubUnavailableError(
      name === "TimeoutError" || name === "AbortError" ? "timeout" : "unreachable",
    );
  }

  if (!response.ok) {
    // Drain the body so the connection can be reused, without reading it into errors.
    await response.body?.cancel().catch(() => undefined);
    throw new GitHubUnavailableError("http_error", response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new GitHubUnavailableError("invalid_response", response.status);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new GitHubUnavailableError("invalid_response", response.status);
  return parsed.data;
}
