import { db, users, UnauthorizedError, checkSystemAdmin } from "./helpers";
import { adminApiTokens } from "@grounded/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { hashString } from "@grounded/shared";
import type { AuthContext } from "./types";

// ============================================================================
// Admin Token Authentication
// ============================================================================

/**
 * Authenticate an admin API token
 * Admin tokens are prefixed with "grounded_admin_"
 */
export async function authenticateAdminToken(token: string): Promise<AuthContext> {
  const tokenHash = await hashString(token);

  const adminToken = await db.query.adminApiTokens.findFirst({
    where: and(
      eq(adminApiTokens.tokenHash, tokenHash),
      isNull(adminApiTokens.revokedAt)
    ),
  });

  if (!adminToken) {
    throw new UnauthorizedError("Invalid admin token");
  }

  if (adminToken.expiresAt && adminToken.expiresAt < new Date()) {
    throw new UnauthorizedError("Admin token expired");
  }

  // Get the user who created this token
  const user = await db.query.users.findFirst({
    where: eq(users.id, adminToken.createdBy),
  });

  if (!user) {
    throw new UnauthorizedError("Admin token user not found");
  }

  if (user.disabledAt) {
    throw new UnauthorizedError("Admin token user disabled");
  }

  // Verify the creator is still a system admin
  const isStillAdmin = await checkSystemAdmin(adminToken.createdBy);
  if (!isStillAdmin) {
    throw new UnauthorizedError("Admin token creator is no longer a system admin");
  }

  // Update last used timestamp
  await db
    .update(adminApiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(adminApiTokens.id, adminToken.id));

  return {
    user: {
      id: user.id,
      email: user.primaryEmail,
      issuer: "admin_token",
      subject: adminToken.id,
    },
    tenantId: null, // Admin tokens are not tenant-scoped
    role: null,
    isSystemAdmin: true,
    apiKeyId: null,
  };
}
