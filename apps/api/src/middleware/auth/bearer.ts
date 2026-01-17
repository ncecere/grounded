import * as jose from "jose";
import { getEnv } from "@grounded/shared";
import { UnauthorizedError, db, users, checkSystemAdmin, resolveTenantContext } from "./helpers";
import type { AuthContext } from "./types";
import { eq } from "drizzle-orm";

// ============================================================================
// Local JWT Configuration
// ============================================================================

const secretString = getEnv("SESSION_SECRET", "dev-secret-change-in-production-must-be-32-chars-or-more");
const paddedSecret = secretString.padEnd(32, "0");
const LOCAL_JWT_SECRET = new TextEncoder().encode(paddedSecret);
export const LOCAL_JWT_ISSUER = "grounded-local";
export const LOCAL_JWT_AUDIENCE = "grounded-api";

// ============================================================================
// Bearer Token Authentication
// ============================================================================

/**
 * Authenticate a local JWT bearer token
 */
export async function authenticateLocalJWT(
  token: string,
  tenantIdHeader: string | undefined
): Promise<AuthContext> {
  try {
    const { payload } = await jose.jwtVerify(token, LOCAL_JWT_SECRET, {
      issuer: LOCAL_JWT_ISSUER,
      audience: LOCAL_JWT_AUDIENCE,
    });

    const userId = payload.sub!;
    const email = (payload.email as string) || null;

    // Verify user exists
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new UnauthorizedError("User not found");
    }

    if (user.disabledAt) {
      throw new UnauthorizedError("Account disabled");
    }

    // Check for system admin
    const isSystemAdmin = await checkSystemAdmin(userId);

    // Get tenant context
    const { tenantId, role } = await resolveTenantContext(
      userId,
      tenantIdHeader,
      isSystemAdmin
    );

    return {
      user: {
        id: userId,
        email: user.primaryEmail,
        issuer: LOCAL_JWT_ISSUER,
        subject: userId,
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
    if (err instanceof jose.errors.JWTInvalid || err instanceof jose.errors.JWTClaimValidationFailed) {
      throw new UnauthorizedError("Invalid token");
    }
    throw err;
  }
}

// Export jose errors for use in oidc module
export { jose };
