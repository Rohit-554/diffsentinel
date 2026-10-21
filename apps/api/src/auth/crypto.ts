import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** An unguessable URL-safe value carrying `bytes` of randomness (256 bits by default). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** PKCE S256 challenge: base64url(SHA-256(verifier)), per RFC 7636. */
export function pkceChallenge(verifier: string): string {
  return sha256(verifier).toString("base64url");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(32);
  return { verifier, challenge: pkceChallenge(verifier) };
}

/**
 * Constant-time string comparison. Hashing first gives equal-length inputs,
 * so neither the content nor the length of `expected` leaks through timing.
 */
export function safeEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(sha256(actual), sha256(expected));
}
