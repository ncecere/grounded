import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { db } from "@grounded/db";
import { adminApiTokens } from "@grounded/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { auth, requireSystemAdmin, withRequestRLS } from "../../middleware/auth";
import { NotFoundError } from "../../middleware/error-handler";
import { hashString } from "@grounded/shared";
import crypto from "crypto";
import { createTokenSchema } from "../../modules/admin/schema";

export const adminTokensRoutes = new Hono();

// All routes require system admin
adminTokensRoutes.use("*", auth(), requireSystemAdmin());

// ============================================================================
// Token Generation
// ============================================================================

const TOKEN_PREFIX = "grounded_admin_";

function generateToken(): string {
  const randomPart = crypto.randomBytes(24).toString("base64url");
  return `${TOKEN_PREFIX}${randomPart}`;
}

// ============================================================================
// List Tokens
// ============================================================================

adminTokensRoutes.get("/", async (c) => {
  const tokens = await withRequestRLS(c, async (tx) => {
    return tx.query.adminApiTokens.findMany({
      where: isNull(adminApiTokens.revokedAt),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    });
  });

  return c.json({
    tokens: tokens.map((t) => ({
      id: t.id,
      name: t.name,
      tokenPrefix: t.tokenPrefix,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
      expiresAt: t.expiresAt,
      createdBy: t.createdBy,
    })),
  });
});

// ============================================================================
// Create Token
// ============================================================================

adminTokensRoutes.post(
  "/",
  zValidator("json", createTokenSchema),
  async (c) => {
    const authContext = c.get("auth");
    const body = c.req.valid("json");

    // Generate the token
    const rawToken = generateToken();
    const tokenHash = await hashString(rawToken);
    const tokenPrefix = rawToken.slice(0, TOKEN_PREFIX.length + 8); // Show prefix + first 8 chars of random part

    // Store the token
    const [token] = await withRequestRLS(c, async (tx) => {
      return tx
        .insert(adminApiTokens)
        .values({
          name: body.name,
          tokenHash,
          tokenPrefix,
          createdBy: authContext.user.id,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        })
        .returning();
    });

    // Return the raw token ONCE
    return c.json({
      id: token.id,
      name: token.name,
      token: rawToken, // Only shown once
      tokenPrefix: token.tokenPrefix,
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
    });
  }
);

// ============================================================================
// Revoke Token
// ============================================================================

adminTokensRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");

  const token = await withRequestRLS(c, async (tx) => {
    return tx.query.adminApiTokens.findFirst({
      where: and(
        eq(adminApiTokens.id, id),
        isNull(adminApiTokens.revokedAt)
      ),
    });
  });

  if (!token) {
    throw new NotFoundError("Token not found");
  }

  await withRequestRLS(c, async (tx) => {
    return tx
      .update(adminApiTokens)
      .set({ revokedAt: new Date() })
      .where(eq(adminApiTokens.id, id));
  });

  return c.json({ message: "Token revoked" });
});
