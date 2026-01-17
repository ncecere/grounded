import { createMiddleware } from "hono/factory";
import { UnauthorizedError, ForbiddenError } from "./helpers";
import type { AuthContext, RLSContext } from "./types";
import { authenticateLocalJWT } from "./bearer";
import { authenticateOIDC, isOIDCConfigured } from "./oidc";
import { authenticateApiKey } from "./api-key";
import { authenticateAdminToken } from "./admin-token";

// ============================================================================
// Bearer Token Router
// ============================================================================

/**
 * Authenticate a bearer token (tries local JWT first, then OIDC)
 */
async function authenticateBearerToken(
  token: string,
  tenantIdHeader: string | undefined
): Promise<AuthContext> {
  // Try local JWT first
  try {
    return await authenticateLocalJWT(token, tenantIdHeader);
  } catch (localError) {
    // If local JWT fails, try OIDC (if configured)
    if (isOIDCConfigured()) {
      try {
        return await authenticateOIDC(token, tenantIdHeader);
      } catch {
        // Both failed - throw the most relevant error
        throw localError;
      }
    }
    throw localError;
  }
}

// ============================================================================
// Auth Middleware
// ============================================================================

/**
 * Main authentication middleware
 * Supports: Local JWT, OIDC, API keys, and Admin tokens
 */
export const auth = () => {
  return createMiddleware(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    const tenantIdHeader = c.req.header("X-Tenant-ID");

    let authContext: AuthContext;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);

      if (token.startsWith("grounded_admin_")) {
        // Admin API token authentication (system-level)
        authContext = await authenticateAdminToken(token);
      } else if (token.startsWith("grounded_")) {
        // Tenant API key authentication (tenant-scoped)
        authContext = await authenticateApiKey(token, tenantIdHeader);
      } else {
        // Bearer token authentication (try local JWT first, then OIDC)
        authContext = await authenticateBearerToken(token, tenantIdHeader);
      }
    } else {
      throw new UnauthorizedError("No authentication provided");
    }

    c.set("auth", authContext);

    // Store RLS context for use with withRequestRLS()
    // Note: SET LOCAL only works within transactions, so we store the context
    // and route handlers use withRequestRLS() to execute queries with proper RLS
    const rlsContext: RLSContext = {
      tenantId: authContext.tenantId,
      userId: authContext.user.id,
      isSystemAdmin: authContext.isSystemAdmin,
    };
    c.set("rlsContext", rlsContext);

    await next();
  });
};

// ============================================================================
// Role-based Access Control Middleware
// ============================================================================

/**
 * Require one of the specified roles
 */
export const requireRole = (...allowedRoles: string[]) => {
  return createMiddleware(async (c, next) => {
    const auth = c.get("auth");

    if (!auth) {
      throw new UnauthorizedError("Not authenticated");
    }

    if (auth.isSystemAdmin) {
      // System admins can do anything
      await next();
      return;
    }

    if (!auth.tenantId) {
      throw new ForbiddenError("No tenant context");
    }

    if (!auth.role || !allowedRoles.includes(auth.role)) {
      throw new ForbiddenError(`Required role: ${allowedRoles.join(" or ")}`);
    }

    await next();
  });
};

/**
 * Require system admin access
 */
export const requireSystemAdmin = () => {
  return createMiddleware(async (c, next) => {
    const auth = c.get("auth");

    if (!auth?.isSystemAdmin) {
      throw new ForbiddenError("System admin access required");
    }

    await next();
  });
};

/**
 * Require tenant context
 */
export const requireTenant = () => {
  return createMiddleware(async (c, next) => {
    const auth = c.get("auth");

    if (!auth?.tenantId) {
      throw new ForbiddenError("Tenant context required");
    }

    await next();
  });
};
