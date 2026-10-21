import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { testDatabaseUrl } from "./test-env";

/**
 * Brings the test database up to the committed migrations. `migrate deploy`
 * creates the database if needed and never drops anything; tests clear their
 * own rows with resetDatabase().
 */
export default function globalSetup(): void {
  const apiRoot = join(__dirname, "..", "..");
  const prisma = join(apiRoot, "node_modules", ".bin", "prisma");
  execFileSync(prisma, ["migrate", "deploy"], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: testDatabaseUrl, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: ["ignore", "ignore", "inherit"],
    shell: process.platform === "win32",
  });
}
