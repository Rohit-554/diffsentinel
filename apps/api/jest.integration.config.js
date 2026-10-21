/**
 * Integration tests: real PostgreSQL and Redis, in a separate test database.
 * Run with `pnpm --filter @diffsentinel/api test:integration`.
 * @type {import('jest').Config}
 */
module.exports = {
  rootDir: ".",
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/integration/**/*.int-spec.ts"],
  globalSetup: "<rootDir>/test/integration/global-setup.ts",
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
  },
  moduleFileExtensions: ["ts", "js", "json"],
  // Tests share one database, so run files one at a time.
  maxWorkers: 1,
};
