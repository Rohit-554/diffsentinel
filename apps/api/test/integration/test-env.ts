import { existsSync } from "node:fs";
import { join } from "node:path";

// Integration tests run against the developer's PostgreSQL and Redis (the
// Compose containers locally, service containers in CI), but never touch the
// development data: they use a separate "<db>_test" database and Redis DB 15.

const ROOT_ENV_FILE = join(__dirname, "..", "..", "..", "..", ".env");
const DEFAULT_DATABASE_URL = "postgresql://diffsentinel:diffsentinel@localhost:5433/diffsentinel";
const DEFAULT_REDIS_URL = "redis://localhost:6379";

if (existsSync(ROOT_ENV_FILE)) process.loadEnvFile(ROOT_ENV_FILE);

function withTestDatabase(url: string): string {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, "") || "postgres";
  parsed.pathname = `/${name.endsWith("_test") ? name : `${name}_test`}`;
  return parsed.toString();
}

function withTestRedisDb(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = "/15";
  return parsed.toString();
}

export const testDatabaseUrl = withTestDatabase(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
export const testRedisUrl = withTestRedisDb(process.env.REDIS_URL ?? DEFAULT_REDIS_URL);

interface RawExecutor {
  $executeRawUnsafe(query: string): Promise<number>;
  $queryRaw<T>(query: TemplateStringsArray): Promise<T>;
}

/** Empties every application table. Refuses to run outside a "*_test" database. */
export async function resetDatabase(prisma: RawExecutor): Promise<void> {
  const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!row?.db.endsWith("_test")) {
    throw new Error("resetDatabase only runs against a *_test database");
  }
  await prisma.$executeRawUnsafe(
    `TRUNCATE audit_events, sessions, repository_access, repositories,
       installation_members, installations, users RESTART IDENTITY CASCADE`,
  );
}
