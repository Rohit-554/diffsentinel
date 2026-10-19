import { readFileSync } from "node:fs";
import { join } from "node:path";
import { API_ENV_KEYS, parseEnv } from "./env";

const envExamplePath = join(__dirname, "..", "..", "..", "..", ".env.example");

function readEnvExample(): Record<string, string> {
  const entries = readFileSync(envExamplePath, "utf8")
    .split(/\r?\n/)
    .map((line) => /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => [match[1] as string, match[2] as string] as const);
  return Object.fromEntries(entries);
}

describe(".env.example", () => {
  const example = readEnvExample();

  it.each(API_ENV_KEYS)("documents %s", (key) => {
    expect(example).toHaveProperty(key);
  });

  it("holds values the API accepts", () => {
    expect(() => parseEnv(example)).not.toThrow();
  });
});
