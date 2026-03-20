export type AuthTier = "unauthed" | "dev" | "admin";

export interface AuthConfig {
  devToken: string | undefined;
  adminToken: string | undefined;
}

/**
 * Resolve the auth tier from a request's Authorization header.
 * Returns the tier, or null if the token is present but invalid.
 */
export function resolveAuthTier(
  authHeader: string | null,
  config: AuthConfig,
): AuthTier | null {
  if (!authHeader) return "unauthed";

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null; // malformed header

  const token = match[1];

  // Admin token also grants dev access
  if (config.adminToken && token === config.adminToken) return "admin";
  if (config.devToken && token === config.devToken) return "dev";

  return null; // token present but doesn't match anything
}

/**
 * Check if a tier meets the required minimum. Returns an error Response
 * if not, or null if authorized.
 */
export function checkAuth(
  tier: AuthTier | null,
  required: AuthTier,
): Response | null {
  if (required === "unauthed") return null; // always allowed

  if (tier === null) {
    return new Response("Invalid token", { status: 401 });
  }

  if (tier === "unauthed") {
    return new Response("Authentication required", { status: 401 });
  }

  if (required === "admin" && tier !== "admin") {
    return new Response("Admin access required", { status: 403 });
  }

  // tier is dev or admin, required is dev → ok
  // tier is admin, required is admin → ok
  return null;
}
