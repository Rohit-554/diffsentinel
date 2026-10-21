/** Holds the opaque session ID; the server stores only its hash. */
export const SESSION_COOKIE = "ds_session";
/** Points at a pending sign-in (state + PKCE verifier) held in Redis. */
export const PENDING_SIGN_IN_COOKIE = "ds_oauth";

export const PENDING_SIGN_IN_TTL_SECONDS = 600;
const PENDING_SIGN_IN_PATH = "/api/v1/auth/github";

/** The subset of Express's cookie options we set. */
export interface CookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge?: number;
}

/**
 * Parses a Cookie header. Names keep their first value (the most specific
 * path comes first); malformed pairs are skipped rather than rejected.
 */
export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    if (!name || cookies.has(name)) continue;
    let value = pair.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies;
}

function baseOptions(publicBaseUrl: string, path: string): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(publicBaseUrl).protocol === "https:",
    path,
  };
}

export function sessionCookieOptions(publicBaseUrl: string, ttlHours: number): CookieOptions {
  return { ...baseOptions(publicBaseUrl, "/"), maxAge: ttlHours * 3_600_000 };
}

/** Options for clearing the session cookie; must match the path it was set with. */
export function clearSessionCookieOptions(publicBaseUrl: string): CookieOptions {
  return baseOptions(publicBaseUrl, "/");
}

/** Scoped to the auth routes so the pending-sign-in cookie never travels elsewhere. */
export function pendingSignInCookieOptions(publicBaseUrl: string): CookieOptions {
  return {
    ...baseOptions(publicBaseUrl, PENDING_SIGN_IN_PATH),
    maxAge: PENDING_SIGN_IN_TTL_SECONDS * 1000,
  };
}

export function clearPendingSignInCookieOptions(publicBaseUrl: string): CookieOptions {
  return baseOptions(publicBaseUrl, PENDING_SIGN_IN_PATH);
}
