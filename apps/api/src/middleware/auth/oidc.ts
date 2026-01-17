import * as jose from "jose";
import { getEnv } from "@grounded/shared";
import { UnauthorizedError, findOrCreateUser, checkSystemAdmin, resolveTenantContext } from "./helpers";
import type { AuthContext } from "./types";

// ============================================================================
// OIDC Configuration
// ============================================================================

const OIDC_ISSUER = getEnv("OIDC_ISSUER", "");
const OIDC_AUDIENCE = getEnv("OIDC_AUDIENCE", "");

let jwks: jose.JWTVerifyGetKey | null = null;

/**
 * Get the JWKS for OIDC token verification (cached)
 */
export async function getJWKS(): Promise<jose.JWTVerifyGetKey> {
  if (!jwks && OIDC_ISSUER) {
    jwks = jose.createRemoteJWKSet(new URL(`${OIDC_ISSUER}/.well-known/jwks.json`));
  }
  if (!jwks) {
    throw new UnauthorizedError("OIDC not configured");
  }
  return jwks;
}

/**
 * Check if OIDC is configured
 */
export function isOIDCConfigured(): boolean {
  return !!OIDC_ISSUER;
}

// ============================================================================
// OIDC Authentication
// ============================================================================

/**
 * Authenticate an OIDC bearer token
 */
export async function authenticateOIDC(
  token: string,
  tenantIdHeader: string | undefined
): Promise<AuthContext> {
  try {
    const jwks = await getJWKS();
    const { payload } = await jose.jwtVerify(token, jwks, {
      issuer: OIDC_ISSUER,
      audience: OIDC_AUDIENCE,
    });

    const issuer = payload.iss!;
    const subject = payload.sub!;
    const email = (payload.email as string) || null;

    // Find or create user
    const user = await findOrCreateUser(issuer, subject, email);

    // Check for system admin
    const isSystemAdmin = await checkSystemAdmin(user.id);

    // Get tenant context
    const { tenantId, role } = await resolveTenantContext(
      user.id,
      tenantIdHeader,
      isSystemAdmin
    );

    return {
      user: {
        id: user.id,
        email: user.primaryEmail,
        issuer,
        subject,
      },
      tenantId,
      role,
      isSystemAdmin,
      apiKeyId: null,
    };
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) {
      throw new UnauthorizedError("Token expired");
    }
    if (err instanceof jose.errors.JWTInvalid) {
      throw new UnauthorizedError("Invalid token");
    }
    throw err;
  }
}
