import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@kcb/db";
import { tenants, tenantMemberships, users, tenantQuotas, tenantAlertSettings } from "@kcb/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { auth, requireRole, requireTenant, requireSystemAdmin } from "../middleware/auth";
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
    const allTenants = await db.query.tenants.findMany({
      where: isNull(tenants.deletedAt),
      orderBy: (tenants, { desc }) => [desc(tenants.createdAt)],
    });

    // Get member counts for each tenant
    const tenantsWithCounts = await Promise.all(
      allTenants.map(async (tenant) => {
        const members = await db.query.tenantMemberships.findMany({
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

    // Check if slug is unique
    const existing = await db.query.tenants.findFirst({
      where: and(eq(tenants.slug, body.slug), isNull(tenants.deletedAt)),
    });

    if (existing) {
      throw new ConflictError("Tenant slug already exists");
    }

    // Determine owner - either specified email or the admin creating
    let ownerId = authContext.user.id;

    if (body.ownerEmail) {
      const ownerUser = await db.query.users.findFirst({
        where: eq(users.primaryEmail, body.ownerEmail.toLowerCase()),
      });

      if (!ownerUser) {
        throw new NotFoundError("User with email " + body.ownerEmail);
      }

      ownerId = ownerUser.id;
    }

    // Create tenant
    const [tenant] = await db
      .insert(tenants)
      .values({
        name: body.name,
        slug: body.slug,
      })
      .returning();

    // Add owner
    await db.insert(tenantMemberships).values({
      tenantId: tenant.id,
      userId: ownerId,
      role: "owner",
    });

    // Create quotas (with optional overrides)
    await db.insert(tenantQuotas).values({
      tenantId: tenant.id,
      ...(body.quotas || {}),
    });

    return c.json({ tenant }, 201);
  }
);

// ============================================================================
// Get Tenant
// ============================================================================

tenantRoutes.get("/:tenantId", auth(), async (c) => {
  const tenantId = c.req.param("tenantId");

  const tenant = await db.query.tenants.findFirst({
    where: and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)),
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

    const [tenant] = await db
      .update(tenants)
      .set(body)
      .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)))
      .returning();

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

    const [tenant] = await db
      .update(tenants)
      .set({ deletedAt: new Date() })
      .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)))
      .returning();

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

  const members = await db
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

    // Find user by email
    const user = await db.query.users.findFirst({
      where: eq(users.primaryEmail, body.email),
    });

    if (!user) {
      throw new NotFoundError("User with this email");
    }

    // Check if already a member
    const existing = await db.query.tenantMemberships.findFirst({
      where: and(
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.userId, user.id),
        isNull(tenantMemberships.deletedAt)
      ),
    });

    if (existing) {
      throw new ConflictError("User is already a member");
    }

    await db.insert(tenantMemberships).values({
      tenantId,
      userId: user.id,
      role: body.role,
    });

    return c.json({ message: "Member added", userId: user.id }, 201);
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

    const [membership] = await db
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

    // Check there's at least one owner remaining
    const owners = await db.query.tenantMemberships.findMany({
      where: and(
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.role, "owner"),
        isNull(tenantMemberships.deletedAt)
      ),
    });

    const targetMembership = await db.query.tenantMemberships.findFirst({
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

    await db
      .update(tenantMemberships)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.userId, userId)
        )
      );

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
    const settings = await db.query.tenantAlertSettings.findFirst({
      where: eq(tenantAlertSettings.tenantId, tenantId),
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
    const [settings] = await db
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

    return c.json({ alertSettings: settings });
  }
);
