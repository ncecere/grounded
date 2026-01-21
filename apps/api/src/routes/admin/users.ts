import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@grounded/db";
import { users, systemAdmins, tenantMemberships, tenants, userCredentials } from "@grounded/db/schema";
import { eq, isNull, sql, and } from "drizzle-orm";
import { auth, requireSystemAdmin, withRequestRLS } from "../../middleware/auth";
import { BadRequestError, NotFoundError } from "../../middleware/error-handler";
import { hashPassword, validatePassword, validateEmail } from "@grounded/shared";
import { createUserSchema, updateUserSchema } from "../../modules/admin/schema";

export const adminUsersRoutes = new Hono();

// All routes require system admin
adminUsersRoutes.use("*", auth(), requireSystemAdmin());

// ============================================================================
// List All Users
// ============================================================================

adminUsersRoutes.get("/", async (c) => {
  const { allUsers, admins, tenantCounts } = await withRequestRLS(c, async (tx) => {
    // Get all users with their system admin status and tenant count
    const allUsers = await tx
      .select({
        id: users.id,
        email: users.primaryEmail,
        createdAt: users.createdAt,
        disabledAt: users.disabledAt,
      })
      .from(users);

    // Get system admins
    const admins = await tx.select({ userId: systemAdmins.userId }).from(systemAdmins);

    // Get tenant counts for each user
    const tenantCounts = await tx
      .select({
        userId: tenantMemberships.userId,
        count: sql<number>`count(*)::int`,
      })
      .from(tenantMemberships)
      .where(isNull(tenantMemberships.deletedAt))
      .groupBy(tenantMemberships.userId);

    return { allUsers, admins, tenantCounts };
  });

  const adminSet = new Set(admins.map((a) => a.userId));
  const tenantCountMap = new Map(tenantCounts.map((tc) => [tc.userId, tc.count]));

  const usersWithDetails = allUsers.map((user) => ({
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    isSystemAdmin: adminSet.has(user.id),
    isDisabled: !!user.disabledAt,
    tenantCount: tenantCountMap.get(user.id) || 0,
  }));

  return c.json({ users: usersWithDetails });
});

// ============================================================================
// Get Single User
// ============================================================================

adminUsersRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");

  const { user, isAdmin, userTenants } = await withRequestRLS(c, async (tx) => {
    const user = await tx.query.users.findFirst({
      where: eq(users.id, id),
    });

    if (!user) {
      return { user: null, isAdmin: null, userTenants: [] };
    }

    // Check if system admin
    const isAdmin = await tx.query.systemAdmins.findFirst({
      where: eq(systemAdmins.userId, id),
    });

    // Get user's tenants
    const userTenants = await tx
      .select({
        tenantId: tenantMemberships.tenantId,
        role: tenantMemberships.role,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
      })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .where(
        and(
          eq(tenantMemberships.userId, id),
          isNull(tenantMemberships.deletedAt),
          isNull(tenants.deletedAt)
        )
      );

    return { user, isAdmin, userTenants };
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  return c.json({
    id: user.id,
    email: user.primaryEmail,
    createdAt: user.createdAt,
    isSystemAdmin: !!isAdmin,
    isDisabled: !!user.disabledAt,
    tenants: userTenants.map((t) => ({
      id: t.tenantId,
      name: t.tenantName,
      slug: t.tenantSlug,
      role: t.role,
    })),
  });
});

// ============================================================================
// Create User
// ============================================================================

adminUsersRoutes.post("/", zValidator("json", createUserSchema), async (c) => {
  const body = c.req.valid("json");

  // Validate email
  if (!validateEmail(body.email)) {
    throw new BadRequestError("Invalid email address");
  }

  // Check if email already exists
  const existingUser = await withRequestRLS(c, async (tx) => {
    return tx.query.users.findFirst({
      where: eq(users.primaryEmail, body.email.toLowerCase()),
    });
  });

  if (existingUser) {
    throw new BadRequestError("A user with this email already exists");
  }

  // Validate password if provided
  if (body.password) {
    const passwordValidation = validatePassword(body.password);
    if (!passwordValidation.valid) {
      throw new BadRequestError(passwordValidation.errors.join(". "));
    }
  }

  const newUser = await withRequestRLS(c, async (tx) => {
    // Create user
    const [newUser] = await tx
      .insert(users)
      .values({
        primaryEmail: body.email.toLowerCase(),
      })
      .returning();

    // If password provided, create credentials
    if (body.password) {
      const passwordHash = await hashPassword(body.password);
      await tx.insert(userCredentials).values({
        userId: newUser.id,
        passwordHash,
      });
    }

    // If system admin, add to system_admins
    if (body.isSystemAdmin) {
      await tx.insert(systemAdmins).values({
        userId: newUser.id,
      });
    }

    return newUser;
  });

  return c.json({
    id: newUser.id,
    email: newUser.primaryEmail,
    isSystemAdmin: body.isSystemAdmin,
  });
});

// ============================================================================
// Update User
// ============================================================================

adminUsersRoutes.patch("/:id", zValidator("json", updateUserSchema), async (c) => {
  const id = c.req.param("id");
  const body = c.req.valid("json");

  const user = await withRequestRLS(c, async (tx) => {
    return tx.query.users.findFirst({
      where: eq(users.id, id),
    });
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  await withRequestRLS(c, async (tx) => {
    // Handle system admin status
    if (body.isSystemAdmin !== undefined) {
      const isCurrentlyAdmin = await tx.query.systemAdmins.findFirst({
        where: eq(systemAdmins.userId, id),
      });

      if (body.isSystemAdmin && !isCurrentlyAdmin) {
        await tx.insert(systemAdmins).values({ userId: id });
      } else if (!body.isSystemAdmin && isCurrentlyAdmin) {
        await tx.delete(systemAdmins).where(eq(systemAdmins.userId, id));
      }
    }

    // Handle disabled status
    if (body.disabled !== undefined) {
      await tx
        .update(users)
        .set({
          disabledAt: body.disabled ? new Date() : null,
        })
        .where(eq(users.id, id));
    }
  });

  return c.json({ message: "User updated" });
});

// ============================================================================
// Delete User
// ============================================================================

adminUsersRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const authContext = c.get("auth");

  // Prevent self-deletion
  if (id === authContext.user.id) {
    throw new BadRequestError("Cannot delete your own account");
  }

  const user = await withRequestRLS(c, async (tx) => {
    return tx.query.users.findFirst({
      where: eq(users.id, id),
    });
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  // Delete user (cascades to credentials, memberships, etc.)
  await withRequestRLS(c, async (tx) => {
    return tx.delete(users).where(eq(users.id, id));
  });

  return c.json({ message: "User deleted" });
});

// ============================================================================
// Reset User Password
// ============================================================================

adminUsersRoutes.post("/:id/reset-password", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const { newPassword } = body;

  const user = await withRequestRLS(c, async (tx) => {
    return tx.query.users.findFirst({
      where: eq(users.id, id),
    });
  });

  if (!user) {
    throw new NotFoundError("User not found");
  }

  // Validate new password
  const passwordValidation = validatePassword(newPassword || "");
  if (!passwordValidation.valid) {
    throw new BadRequestError(passwordValidation.errors.join(". "));
  }

  const passwordHash = await hashPassword(newPassword);

  // Upsert credentials
  await withRequestRLS(c, async (tx) => {
    return tx
      .insert(userCredentials)
      .values({
        userId: id,
        passwordHash,
      })
      .onConflictDoUpdate({
        target: userCredentials.userId,
        set: {
          passwordHash,
          updatedAt: new Date(),
        },
      });
  });

  return c.json({ message: "Password reset successfully" });
});
