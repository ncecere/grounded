import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@grounded/db";
import { tenants, tenantMemberships, users, tenantQuotas, tenantAlertSettings, apiKeys } from "@grounded/db/schema";
import { hashString } from "@grounded/shared";
import crypto from "crypto";
import { eq, and, isNull } from "drizzle-orm";
import { auth, requireRole, requireTenant, requireSystemAdmin, withRequestRLS } from "../middleware/auth";
import { NotFoundError, BadRequestError, ConflictError } from "../middleware/error-handler";

export const tenantRoutes = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const quotaOverridesSchema = z.object({
  maxKbs: z.number().int().min(1).max(1000).optional(),
  maxAgents: z.number().int().min(1).max(1000).optional(),
  maxUploadedDocsPerMonth: z.number().int().min(1).max(100000).optional(),
  maxScrapedPagesPerMonth: z.number().int().min(1).max(100000).optional(),
  maxCrawlConcurrency: z.number().int().min(1).max(50).optional(),
  chatRateLimitPerMinute: z.number().int().min(1).max(1000).optional(),
});

const createTenantSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  ownerEmail: z.string().email().optional(), // If not provided, admin creating becomes owner
  quotas: quotaOverridesSchema.optional(),
});

const updateTenantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["owner", "admin", "member", "viewer"]),
});

const updateMemberSchema = z.object({
  role: z.enum(["owner", "admin", "member", "viewer"]),
});

const updateAlertSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  notifyOwners: z.boolean().optional(),
  notifyAdmins: z.boolean().optional(),
  additionalEmails: z.string().optional().nullable(),
  errorRateThreshold: z.number().int().min(1).max(100).optional().nullable(),
  quotaWarningThreshold: z.number().int().min(1).max(100).optional().nullable(),
  inactivityDays: z.number().int().min(0).max(365).optional().nullable(),
});

// ============================================================================
// List All Tenants (System Admin Only)
// ============================================================================

tenantRoutes.get(
  "/",
  auth(),
  requireSystemAdmin(),
  async (c) => {
    const tenantsWithCounts = await withRequestRLS(c, async (tx) => {
      const allTenants = await tx.query.tenants.findMany({
        where: isNull(tenants.deletedAt),
        orderBy: (tenants, { desc }) => [desc(tenants.createdAt)],
      });

      // Get member counts for each tenant
      return Promise.all(
        allTenants.map(async (tenant) => {
          const members = await tx.query.tenantMemberships.findMany({
            where: and(
              eq(tenantMemberships.tenantId, tenant.id),
              isNull(tenantMemberships.deletedAt)
            ),
          });
          return {
            ...tenant,
            memberCount: members.length,
          };
        })
      );
    });

    return c.json({ tenants: tenantsWithCounts });
  }
);

// ============================================================================
// Create Tenant (System Admin Only)
// ============================================================================

tenantRoutes.post(
  "/",
  auth(),
  requireSystemAdmin(),
  zValidator("json", createTenantSchema),
  async (c) => {
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    const tenant = await withRequestRLS(c, async (tx) => {
      // Check if slug is unique
      const existing = await tx.query.tenants.findFirst({
        where: and(eq(tenants.slug, body.slug), isNull(tenants.deletedAt)),
      });

      if (existing) {
        throw new ConflictError("Tenant slug already exists");
      }

      // Determine owner - either specified email or the admin creating
      let ownerId = authContext.user.id;

      if (body.ownerEmail) {
        const ownerUser = await tx.query.users.findFirst({
          where: eq(users.primaryEmail, body.ownerEmail.toLowerCase()),
        });

        if (!ownerUser) {
          throw new NotFoundError("User with email " + body.ownerEmail);
        }

        ownerId = ownerUser.id;
      }

      // Create tenant
      const [newTenant] = await tx
        .insert(tenants)
        .values({
          name: body.name,
          slug: body.slug,
        })
        .returning();

      // Add owner
      await tx.insert(tenantMemberships).values({
        tenantId: newTenant.id,
        userId: ownerId,
        role: "owner",
      });

      // Create quotas (with optional overrides)
      await tx.insert(tenantQuotas).values({
        tenantId: newTenant.id,
        ...(body.quotas || {}),
      });

      return newTenant;
    });

    return c.json({ tenant }, 201);
  }
);

// ============================================================================
// Get Tenant
// ============================================================================

tenantRoutes.get("/:tenantId", auth(), async (c) => {
  const tenantId = c.req.param("tenantId");

  const tenant = await withRequestRLS(c, async (tx) => {
    return tx.query.tenants.findFirst({
      where: and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)),
    });
  });

  if (!tenant) {
    throw new NotFoundError("Tenant");
  }

  return c.json({ tenant });
});

// ============================================================================
// Update Tenant
// ============================================================================

tenantRoutes.patch(
  "/:tenantId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", updateTenantSchema),
  async (c) => {
    const tenantId = c.req.param("tenantId");
    const body = c.req.valid("json");

    const tenant = await withRequestRLS(c, async (tx) => {
      const [updated] = await tx
        .update(tenants)
        .set(body)
        .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)))
        .returning();
      return updated;
    });

    if (!tenant) {
      throw new NotFoundError("Tenant");
    }

    return c.json({ tenant });
  }
);

// ============================================================================
// Delete Tenant (Soft Delete)
// ============================================================================

tenantRoutes.delete(
  "/:tenantId",
  auth(),
  requireTenant(),
  requireRole("owner"),
  async (c) => {
    const tenantId = c.req.param("tenantId");

    const tenant = await withRequestRLS(c, async (tx) => {
      const [deleted] = await tx
        .update(tenants)
        .set({ deletedAt: new Date() })
        .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)))
        .returning();
      return deleted;
    });

    if (!tenant) {
      throw new NotFoundError("Tenant");
    }

    // Schedule hard delete (would queue a deletion job here)
    // await addHardDeleteJob({ tenantId, objectType: "tenant", objectId: tenantId });

    return c.json({ message: "Tenant scheduled for deletion" });
  }
);

// ============================================================================
// List Members
// ============================================================================

tenantRoutes.get("/:tenantId/members", auth(), requireTenant(), async (c) => {
  const tenantId = c.req.param("tenantId");

  const members = await withRequestRLS(c, async (tx) => {
    return tx
      .select({
        userId: tenantMemberships.userId,
        role: tenantMemberships.role,
        email: users.primaryEmail,
        createdAt: tenantMemberships.createdAt,
      })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          isNull(tenantMemberships.deletedAt)
        )
      );
  });

  return c.json({ members });
});

// ============================================================================
// Add Member
// ============================================================================

tenantRoutes.post(
  "/:tenantId/members",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", addMemberSchema),
  async (c) => {
    const tenantId = c.req.param("tenantId");
    const body = c.req.valid("json");

    const userId = await withRequestRLS(c, async (tx) => {
      // Find user by email
      const user = await tx.query.users.findFirst({
        where: eq(users.primaryEmail, body.email),
      });

      if (!user) {
        throw new NotFoundError("User with this email");
      }

      // Check if already a member
      const existing = await tx.query.tenantMemberships.findFirst({
        where: and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.userId, user.id),
          isNull(tenantMemberships.deletedAt)
        ),
      });

      if (existing) {
        throw new ConflictError("User is already a member");
      }

      await tx.insert(tenantMemberships).values({
        tenantId,
        userId: user.id,
        role: body.role,
      });

      return user.id;
    });

    return c.json({ message: "Member added", userId }, 201);
  }
);

// ============================================================================
// Update Member Role
// ============================================================================

tenantRoutes.patch(
  "/:tenantId/members/:userId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", updateMemberSchema),
  async (c) => {
    const tenantId = c.req.param("tenantId");
    const userId = c.req.param("userId");
    const body = c.req.valid("json");
    const authContext = c.get("auth");

    // Can't change own role
    if (userId === authContext.user.id) {
      throw new BadRequestError("Cannot change your own role");
    }

    // Check if changing to owner (only owners can do this)
    if (body.role === "owner" && authContext.role !== "owner") {
      throw new BadRequestError("Only owners can assign owner role");
    }

    const membership = await withRequestRLS(c, async (tx) => {
      const [updated] = await tx
        .update(tenantMemberships)
        .set({ role: body.role })
        .where(
          and(
            eq(tenantMemberships.tenantId, tenantId),
            eq(tenantMemberships.userId, userId),
            isNull(tenantMemberships.deletedAt)
          )
        )
        .returning();
      return updated;
    });

    if (!membership) {
      throw new NotFoundError("Member");
    }

    return c.json({ message: "Role updated", role: body.role });
  }
);

// ============================================================================
// Remove Member
// ============================================================================

tenantRoutes.delete(
  "/:tenantId/members/:userId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const tenantId = c.req.param("tenantId");
    const userId = c.req.param("userId");
    const authContext = c.get("auth");

    // Can't remove yourself
    if (userId === authContext.user.id) {
      throw new BadRequestError("Cannot remove yourself");
    }

    await withRequestRLS(c, async (tx) => {
      // Check there's at least one owner remaining
      const owners = await tx.query.tenantMemberships.findMany({
        where: and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.role, "owner"),
          isNull(tenantMemberships.deletedAt)
        ),
      });

      const targetMembership = await tx.query.tenantMemberships.findFirst({
        where: and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.userId, userId),
          isNull(tenantMemberships.deletedAt)
        ),
      });

      if (!targetMembership) {
        throw new NotFoundError("Member");
      }

      if (targetMembership.role === "owner" && owners.length <= 1) {
        throw new BadRequestError("Cannot remove the last owner");
      }

      await tx
        .update(tenantMemberships)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(tenantMemberships.tenantId, tenantId),
            eq(tenantMemberships.userId, userId)
          )
        );
    });

    return c.json({ message: "Member removed" });
  }
);

// ============================================================================
// Get Tenant Alert Settings
// ============================================================================

tenantRoutes.get(
  "/:tenantId/alert-settings",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const tenantId = c.req.param("tenantId");

    // Get existing settings or return defaults
    const settings = await withRequestRLS(c, async (tx) => {
      return tx.query.tenantAlertSettings.findFirst({
        where: eq(tenantAlertSettings.tenantId, tenantId),
      });
    });

    if (settings) {
      return c.json({ alertSettings: settings });
    }

    // Return defaults if no settings exist
    return c.json({
      alertSettings: {
        tenantId,
        enabled: true,
        notifyOwners: true,
        notifyAdmins: false,
        additionalEmails: null,
        errorRateThreshold: null,
        quotaWarningThreshold: null,
        inactivityDays: null,
        createdAt: null,
        updatedAt: null,
      },
    });
  }
);

// ============================================================================
// Update Tenant Alert Settings
// ============================================================================

tenantRoutes.put(
  "/:tenantId/alert-settings",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", updateAlertSettingsSchema),
  async (c) => {
    const tenantId = c.req.param("tenantId");
    const body = c.req.valid("json");

    // Validate additionalEmails if provided
    if (body.additionalEmails) {
      const emails = body.additionalEmails.split(",").map((e) => e.trim());
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (const email of emails) {
        if (!emailRegex.test(email)) {
          throw new BadRequestError(`Invalid email address: ${email}`);
        }
      }
    }

    // Upsert the settings
    const settings = await withRequestRLS(c, async (tx) => {
      const [upserted] = await tx
        .insert(tenantAlertSettings)
        .values({
          tenantId,
          enabled: body.enabled ?? true,
          notifyOwners: body.notifyOwners ?? true,
          notifyAdmins: body.notifyAdmins ?? false,
          additionalEmails: body.additionalEmails ?? null,
          errorRateThreshold: body.errorRateThreshold ?? null,
          quotaWarningThreshold: body.quotaWarningThreshold ?? null,
          inactivityDays: body.inactivityDays ?? null,
        })
        .onConflictDoUpdate({
          target: tenantAlertSettings.tenantId,
          set: {
            enabled: body.enabled,
            notifyOwners: body.notifyOwners,
            notifyAdmins: body.notifyAdmins,
            additionalEmails: body.additionalEmails,
            errorRateThreshold: body.errorRateThreshold,
            quotaWarningThreshold: body.quotaWarningThreshold,
            inactivityDays: body.inactivityDays,
            updatedAt: new Date(),
          },
        })
        .returning();
      return upserted;
    });

    return c.json({ alertSettings: settings });
  }
);

// ============================================================================
// Tenant API Keys
// ============================================================================

const API_KEY_PREFIX = "grounded_";

function generateApiKey(): string {
  const randomPart = crypto.randomBytes(24).toString("base64url");
  return `${API_KEY_PREFIX}${randomPart}`;
}

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(["chat", "read", "write"])).optional().default(["chat", "read"]),
  expiresAt: z.string().datetime().optional(),
});

// List API Keys
tenantRoutes.get(
  "/:tenantId/api-keys",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const tenantId = c.req.param("tenantId");

    const keys = await withRequestRLS(c, async (tx) => {
      return tx.query.apiKeys.findMany({
        where: and(
          eq(apiKeys.tenantId, tenantId),
          isNull(apiKeys.revokedAt)
        ),
        orderBy: (k, { desc }) => [desc(k.createdAt)],
      });
    });

    return c.json({
      apiKeys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        scopes: k.scopes,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        expiresAt: k.expiresAt,
        createdBy: k.createdBy,
      })),
    });
  }
);

// Create API Key
tenantRoutes.post(
  "/:tenantId/api-keys",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  zValidator("json", createApiKeySchema),
  async (c) => {
    const tenantId = c.req.param("tenantId");
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    // Generate the key
    const rawKey = generateApiKey();
    const keyHash = await hashString(rawKey);
    const keyPrefix = rawKey.slice(0, API_KEY_PREFIX.length + 8); // Show prefix + first 8 chars

    // Store the key
    const key = await withRequestRLS(c, async (tx) => {
      const [created] = await tx
        .insert(apiKeys)
        .values({
          tenantId,
          name: body.name,
          keyHash,
          keyPrefix,
          scopes: body.scopes,
          createdBy: authContext.user.id,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        })
        .returning();
      return created;
    });

    // Return the raw key ONCE
    return c.json({
      id: key.id,
      name: key.name,
      apiKey: rawKey, // Only shown once
      keyPrefix: key.keyPrefix,
      scopes: key.scopes,
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
    });
  }
);

// Revoke API Key
tenantRoutes.delete(
  "/:tenantId/api-keys/:keyId",
  auth(),
  requireTenant(),
  requireRole("owner", "admin"),
  async (c) => {
    const tenantId = c.req.param("tenantId");
    const keyId = c.req.param("keyId");

    await withRequestRLS(c, async (tx) => {
      const key = await tx.query.apiKeys.findFirst({
        where: and(
          eq(apiKeys.id, keyId),
          eq(apiKeys.tenantId, tenantId),
          isNull(apiKeys.revokedAt)
        ),
      });

      if (!key) {
        throw new NotFoundError("API key");
      }

      await tx
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(eq(apiKeys.id, keyId));
    });

    return c.json({ message: "API key revoked" });
  }
);
