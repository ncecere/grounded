import { db, withRLSContext } from "@grounded/db";
import { users, userIdentities, tenantMemberships, systemAdmins } from "@grounded/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { UnauthorizedError, ForbiddenError } from "../error-handler";
import type { AuthContext, Database, RLSContext } from "./types";

// ============================================================================
// Shared Helper Functions
// ============================================================================

/**
 * Execute a database operation with the RLS context from the current request.
 * This wraps the operation in a transaction with SET LOCAL for proper RLS enforcement.
 *
 * @example
 * ```ts
 * app.get("/items", auth(), async (c) => {
 *   const items = await withRequestRLS(c, async (tx) => {
 *     return tx.query.items.findMany();
 *   });
 *   return c.json({ items });
 * });
 * ```
 */
export async function withRequestRLS<T>(
  c: { get: (key: "rlsContext") => RLSContext | undefined },
  fn: (tx: Database) => Promise<T>
): Promise<T> {
  const rlsContext = c.get("rlsContext");
  if (!rlsContext) {
    // No RLS context set - run without RLS (for unauthenticated routes)
    return fn(db as Database);
  }
  return withRLSContext(rlsContext, fn);
}

/**
 * Check if a user is a system admin
 */
export async function checkSystemAdmin(userId: string): Promise<boolean> {
  const admin = await db.query.systemAdmins.findFirst({
    where: eq(systemAdmins.userId, userId),
  });
  return !!admin;
}

/**
 * Find or create a user from an OIDC identity
 */
export async function findOrCreateUser(
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

/**
 * Get tenant membership for a user
 */
export async function getTenantMembership(
  userId: string,
  tenantId: string
): Promise<{ tenantId: string; role: string } | null> {
  const membership = await db.query.tenantMemberships.findFirst({
    where: and(
      eq(tenantMemberships.userId, userId),
      eq(tenantMemberships.tenantId, tenantId),
      isNull(tenantMemberships.deletedAt)
    ),
  });

  if (!membership) {
    return null;
  }

  return {
    tenantId: membership.tenantId,
    role: membership.role,
  };
}

/**
 * Resolve tenant context for a user
 * Returns tenantId and role if user has access, throws if not
 */
export async function resolveTenantContext(
  userId: string,
  tenantIdHeader: string | undefined,
  isSystemAdmin: boolean
): Promise<{ tenantId: string | null; role: string | null }> {
  if (!tenantIdHeader) {
    return { tenantId: null, role: null };
  }

  const membership = await getTenantMembership(userId, tenantIdHeader);

  if (membership) {
    return { tenantId: membership.tenantId, role: membership.role };
  }

  if (!isSystemAdmin) {
    throw new ForbiddenError("Not a member of this tenant");
  }

  // System admins can access any tenant
  return { tenantId: tenantIdHeader, role: null };
}

export { db, users, UnauthorizedError, ForbiddenError };
