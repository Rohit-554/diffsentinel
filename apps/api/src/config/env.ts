import type { LogLevel } from "@nestjs/common";
import { z } from "zod";

const urlWithProtocol = (protocols: readonly string[]) =>
  z.string().refine(
    (value) => {
      try {
        return protocols.includes(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    { message: `must be a valid URL using ${protocols.join(" or ")}` },
  );

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "verbose"] as const;

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  DATABASE_URL: urlWithProtocol(["postgres:", "postgresql:"]),
  REDIS_URL: urlWithProtocol(["redis:", "rediss:"]),
});

/** Every environment variable the API reads; kept in sync with .env.example by a test. */
export const API_ENV_KEYS = Object.keys(envSchema.shape);

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  /** Levels passed to the Nest logger, from LOG_LEVEL down to "fatal". */
  logLevels: LogLevel[];
  databaseUrl: string;
  redisUrl: string;
}

export class ConfigValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigValidationError";
  }
}

// Nest calls "info" "log"; order runs from most to least severe.
const NEST_LEVELS: Record<(typeof LOG_LEVELS)[number], LogLevel> = {
  fatal: "fatal",
  error: "error",
  warn: "warn",
  info: "log",
  debug: "debug",
  verbose: "verbose",
};

function levelsUpTo(level: (typeof LOG_LEVELS)[number]): LogLevel[] {
  return LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(level) + 1).map((l) => NEST_LEVELS[l]);
}

/**
 * Validates the environment and returns typed config.
 * Error messages name variables and rules only, never the supplied values,
 * because values such as DATABASE_URL carry credentials.
 */
export function parseEnv(env: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  const e = result.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.API_PORT,
    logLevels: levelsUpTo(e.LOG_LEVEL),
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
  };
}
