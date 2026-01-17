import { db, users, UnauthorizedError, ForbiddenError } from "./helpers";
import { apiKeys, tenantMemberships } from "@grounded/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { hashString } from "@grounded/shared";
import type { AuthContext } from "./types";

// ============================================================================
// API Key Authentication
// ============================================================================

/**
 * Authenticate a tenant-scoped API key
 * API keys are prefixed with "grounded_"
 */
export async function authenticateApiKey(
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
