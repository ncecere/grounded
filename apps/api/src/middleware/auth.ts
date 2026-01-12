import { createMiddleware } from "hono/factory";
import * as jose from "jose";
import { db } from "@grounded/db";
import { users, userIdentities, tenantMemberships, apiKeys, systemAdmins } from "@grounded/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { getEnv, hashString } from "@grounded/shared";
import { UnauthorizedError, ForbiddenError } from "./error-handler";

// ============================================================================
// Types
// ============================================================================

export interface AuthUser {
  id: string;
  email: string | null;
  issuer: string;
  subject: string;
}

export interface AuthContext {
  user: AuthUser;
  tenantId: string | null;
  role: string | null;
  isSystemAdmin: boolean;
  apiKeyId: string | null;
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
    requestId: string;
  }
}

// ============================================================================
// OIDC Configuration
// ============================================================================

const OIDC_ISSUER = getEnv("OIDC_ISSUER", "");
const OIDC_AUDIENCE = getEnv("OIDC_AUDIENCE", "");

let jwks: jose.JWTVerifyGetKey | null = null;

async function getJWKS(): Promise<jose.JWTVerifyGetKey> {
  if (!jwks && OIDC_ISSUER) {
    jwks = jose.createRemoteJWKSet(new URL(`${OIDC_ISSUER}/.well-known/jwks.json`));
  }
  if (!jwks) {
    throw new UnauthorizedError("OIDC not configured");
  }
  return jwks;
}

// ============================================================================
// Local JWT Configuration
// ============================================================================

const secretString = getEnv("SESSION_SECRET", "dev-secret-change-in-production-must-be-32-chars-or-more");
const paddedSecret = secretString.padEnd(32, "0");
const LOCAL_JWT_SECRET = new TextEncoder().encode(paddedSecret);
const LOCAL_JWT_ISSUER = "grounded-local";
const LOCAL_JWT_AUDIENCE = "grounded-api";

// ============================================================================
// Auth Middleware
// ============================================================================

export const auth = () => {
  return createMiddleware(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    const apiKeyHeader = c.req.header("X-API-Key");
    const tenantIdHeader = c.req.header("X-Tenant-ID");

    let authContext: AuthContext;

    if (apiKeyHeader) {
      // API Key authentication
      authContext = await authenticateApiKey(apiKeyHeader, tenantIdHeader);
    } else if (authHeader?.startsWith("Bearer ")) {
      // Bearer token authentication (try local JWT first, then OIDC)
      const token = authHeader.slice(7);
      authContext = await authenticateBearerToken(token, tenantIdHeader);
    } else {
      throw new UnauthorizedError("No authentication provided");
    }

    c.set("auth", authContext);

    // Set tenant context for RLS if applicable
    if (authContext.tenantId) {
      await db.execute(`SET LOCAL app.tenant_id = '${authContext.tenantId}'`);
    }
    if (authContext.user.id) {
      await db.execute(`SET LOCAL app.user_id = '${authContext.user.id}'`);
    }
    if (authContext.isSystemAdmin) {
      await db.execute(`SET LOCAL app.is_system_admin = 'true'`);
    }

    await next();
  });
};

// ============================================================================
// Role-based Access Control
// ============================================================================

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

export const requireSystemAdmin = () => {
  return createMiddleware(async (c, next) => {
    const auth = c.get("auth");

    if (!auth?.isSystemAdmin) {
      throw new ForbiddenError("System admin access required");
    }

    await next();
  });
};

export const requireTenant = () => {
  return createMiddleware(async (c, next) => {
    const auth = c.get("auth");

    if (!auth?.tenantId) {
      throw new ForbiddenError("Tenant context required");
    }

    await next();
  });
};

// ============================================================================
// Authentication Helpers
// ============================================================================

async function authenticateBearerToken(
  token: string,
  tenantIdHeader: string | undefined
): Promise<AuthContext> {
  // Try local JWT first
  try {
    return await authenticateLocalJWT(token, tenantIdHeader);
  } catch (localError) {
    // If local JWT fails, try OIDC (if configured)
    if (OIDC_ISSUER) {
      try {
        return await authenticateOIDC(token, tenantIdHeader);
      } catch (oidcError) {
        // Both failed - throw the most relevant error
        throw localError;
      }
    }
    throw localError;
  }
}

async function authenticateLocalJWT(
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
    let tenantId: string | null = null;
    let role: string | null = null;

    if (tenantIdHeader) {
      const membership = await db.query.tenantMemberships.findFirst({
        where: and(
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.tenantId, tenantIdHeader),
          isNull(tenantMemberships.deletedAt)
        ),
      });

      if (membership) {
        tenantId = membership.tenantId;
        role = membership.role;
      } else if (!isSystemAdmin) {
        throw new ForbiddenError("Not a member of this tenant");
      } else {
        tenantId = tenantIdHeader;
      }
    }

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

async function authenticateOIDC(
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
    let user = await findOrCreateUser(issuer, subject, email);

    // Check for system admin
    const isSystemAdmin = await checkSystemAdmin(user.id);

    // Get tenant context
    let tenantId: string | null = null;
    let role: string | null = null;

    if (tenantIdHeader) {
      const membership = await db.query.tenantMemberships.findFirst({
        where: and(
          eq(tenantMemberships.userId, user.id),
          eq(tenantMemberships.tenantId, tenantIdHeader),
          isNull(tenantMemberships.deletedAt)
        ),
      });

      if (membership) {
        tenantId = membership.tenantId;
        role = membership.role;
      } else if (!isSystemAdmin) {
        throw new ForbiddenError("Not a member of this tenant");
      } else {
        tenantId = tenantIdHeader;
      }
    }

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

async function authenticateApiKey(
  apiKey: string,
  tenantIdHeader: string | undefined
): Promise<AuthContext> {
  const keyHash = await hashString(apiKey);

  const key = await db.query.apiKeys.findFirst({
    where: and(
      eq(apiKeys.keyHash, keyHash),
      isNull(apiKeys.revokedAt)
    ),
  });

  if (!key) {
    throw new UnauthorizedError("Invalid API key");
  }

  if (key.expiresAt && key.expiresAt < new Date()) {
    throw new UnauthorizedError("API key expired");
  }

  // Update last used
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id));

  // Get user
  const user = await db.query.users.findFirst({
    where: eq(users.id, key.createdBy),
  });

  if (!user) {
    throw new UnauthorizedError("API key user not found");
  }

  // API keys are always scoped to their tenant
  const tenantId = tenantIdHeader || key.tenantId;

  if (tenantId !== key.tenantId) {
    throw new ForbiddenError("API key not valid for this tenant");
  }

  const membership = await db.query.tenantMemberships.findFirst({
    where: and(
      eq(tenantMemberships.userId, user.id),
      eq(tenantMemberships.tenantId, tenantId),
      isNull(tenantMemberships.deletedAt)
    ),
  });

  return {
    user: {
      id: user.id,
      email: user.primaryEmail,
      issuer: "api_key",
      subject: key.id,
    },
    tenantId,
    role: membership?.role || null,
    isSystemAdmin: false,
    apiKeyId: key.id,
  };
}

async function findOrCreateUser(
  issuer: string,
  subject: string,
  email: string | null
): Promise<{ id: string; primaryEmail: string | null }> {
  // Try to find existing identity
  const identity = await db.query.userIdentities.findFirst({
    where: and(
      eq(userIdentities.issuer, issuer),
      eq(userIdentities.subject, subject)
    ),
  });

  if (identity) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, identity.userId),
    });
    return user!;
  }

  // Create new user and identity
  const [newUser] = await db
    .insert(users)
    .values({
      primaryEmail: email,
    })
    .returning();

  await db.insert(userIdentities).values({
    userId: newUser.id,
    issuer,
    subject,
    email,
  });

  return newUser;
}

async function checkSystemAdmin(userId: string): Promise<boolean> {
  const admin = await db.query.systemAdmins.findFirst({
    where: eq(systemAdmins.userId, userId),
  });
  return !!admin;
}
