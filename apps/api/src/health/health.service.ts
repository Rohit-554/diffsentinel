import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { PrismaService } from "../infra/prisma.service";
import { RedisService } from "../infra/redis.service";
import type {
  CheckErrorCategory,
  DependencyCheck,
  LivenessResponse,
  ReadinessResponse,
} from "./health.types";

export const HEALTH_CHECK_TIMEOUT_MS = Symbol("HEALTH_CHECK_TIMEOUT_MS");
const DEFAULT_TIMEOUT_MS = 2000;

class CheckTimeoutError extends Error {
  override readonly name = "CheckTimeoutError";
}

// apps/api/package.json sits two levels above both src/health and dist/health.
const VERSION = (
  JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as {
    version: string;
  }
).version;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly probes: Record<string, () => Promise<void>>;

  constructor(
    prisma: PrismaService,
    redis: RedisService,
    @Optional()
    @Inject(HEALTH_CHECK_TIMEOUT_MS)
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    this.probes = {
      postgres: () => prisma.ping(),
      redis: () => redis.ping(),
    };
  }

  /** Liveness: no I/O, so a dependency outage never marks the process dead. */
  liveness(): LivenessResponse {
    return { status: "ok", service: "api", version: VERSION };
  }

  /** Readiness: probes every dependency concurrently, each bounded by the timeout. */
  async readiness(): Promise<ReadinessResponse> {
    const names = Object.keys(this.probes);
    const results = await Promise.all(names.map((name) => this.check(name)));
    const checks = Object.fromEntries(names.map((name, i) => [name, results[i]!]));
    const allUp = results.every((r) => r.status === "up");
    return { status: allUp ? "ok" : "unavailable", service: "api", checks };
  }

  private async check(name: string): Promise<DependencyCheck> {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    try {
      await this.withTimeout(this.probes[name]!());
      return { status: "up", latencyMs: elapsed() };
    } catch (err) {
      const error: CheckErrorCategory =
        err instanceof CheckTimeoutError ? "timeout" : "unreachable";
      // Log the error class and code only: driver messages can contain hosts or URLs.
      this.logger.warn(`Readiness check failed: ${name} (${error}, ${describe(err)})`);
      return { status: "down", latencyMs: elapsed(), error };
    }
  }

  private withTimeout(probe: Promise<void>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CheckTimeoutError()), this.timeoutMs);
    });
    return Promise.race([probe, timeout]).finally(() => clearTimeout(timer));
  }
}

function describe(err: unknown): string {
  if (!(err instanceof Error)) return "unknown";
  const { code, errorCode } = err as { code?: unknown; errorCode?: unknown };
  const detail = typeof code === "string" ? code : typeof errorCode === "string" ? errorCode : "";
  return detail ? `${err.name} ${detail}` : err.name;
}
