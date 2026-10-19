export interface DependencyCheck {
  status: "up" | "down";
  latencyMs: number;
  error?: string;
}

export interface Readiness {
  status: "ok" | "unavailable";
  service: string;
  checks: Record<string, DependencyCheck>;
}

/** The API could not be reached or did not answer with a readiness report. */
export class ApiUnavailableError extends Error {
  constructor() {
    super("API unavailable");
    this.name = "ApiUnavailableError";
  }
}

function isDependencyCheck(value: unknown): value is DependencyCheck {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (v.status === "up" || v.status === "down") && typeof v.latencyMs === "number";
}

function isReadiness(value: unknown): value is Readiness {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.status === "ok" || v.status === "unavailable") &&
    typeof v.service === "string" &&
    typeof v.checks === "object" &&
    v.checks !== null &&
    Object.values(v.checks).every(isDependencyCheck)
  );
}

/**
 * Reads the API readiness report. A 503 is a valid answer (some dependency is
 * down) and is returned as data; only a network failure, an unexpected status
 * or a malformed body counts as the API being unavailable.
 */
export async function fetchReadiness(signal?: AbortSignal): Promise<Readiness> {
  let res: Response;
  try {
    res = await fetch("/api/v1/health/ready", {
      headers: { Accept: "application/json" },
      ...(signal ? { signal } : {}),
    });
  } catch {
    throw new ApiUnavailableError();
  }
  if (res.status !== 200 && res.status !== 503) throw new ApiUnavailableError();

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiUnavailableError();
  }
  if (!isReadiness(body)) throw new ApiUnavailableError();
  return body;
}
