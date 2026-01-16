import { Hono } from "hono";
import { db } from "@grounded/db";
import { tenantMemberships, tenants, users, userCredentials } from "@grounded/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { getEnv, hashPassword, verifyPassword, validatePassword, validateEmail } from "@grounded/shared";
import * as jose from "jose";
import { auth } from "../middleware/auth";
import { BadRequestError, UnauthorizedError } from "../middleware/error-handler";
import { auditService, extractIpAddress } from "../services/audit";

export const authRoutes = new Hono();

const OIDC_ISSUER = getEnv("OIDC_ISSUER", "");
const OIDC_CLIENT_ID = getEnv("OIDC_CLIENT_ID", "");
const OIDC_REDIRECT_URI = getEnv("OIDC_REDIRECT_URI", "");

// JWT secret for local auth tokens (must be at least 32 bytes for HS256)
const secretString = getEnv("SESSION_SECRET", "dev-secret-change-in-production-must-be-32-chars-or-more");
// Pad the secret to ensure it's at least 32 bytes
const paddedSecret = secretString.padEnd(32, "0");
const JWT_SECRET = new TextEncoder().encode(paddedSecret);
const JWT_ISSUER = "grounded-local";
const JWT_AUDIENCE = "grounded-api";
const JWT_EXPIRES_IN = "7d";

// ============================================================================
// JWT Helper
// ============================================================================

async function generateLocalJWT(userId: string, email: string): Promise<string> {
  return new jose.SignJWT({
    sub: userId,
    email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(JWT_SECRET);
}

// ============================================================================
// Local Auth - Register
// ============================================================================

authRoutes.post("/register", async (c) => {
  const body = await c.req.json();
  const { email, password, name } = body;

  // Validate email
  if (!email || !validateEmail(email)) {
    throw new BadRequestError("Invalid email address");
  }

  // Validate password
  const passwordValidation = validatePassword(password || "");
  if (!passwordValidation.valid) {
    throw new BadRequestError(passwordValidation.errors.join(". "));
  }

  // Check if email already exists
  const existingUser = await db.query.users.findFirst({
    where: eq(users.primaryEmail, email.toLowerCase()),
  });

  if (existingUser) {
    throw new BadRequestError("An account with this email already exists");
  }

  // Create user
  const [newUser] = await db
    .insert(users)
    .values({
      primaryEmail: email.toLowerCase(),
    })
    .returning();

  // Hash and store password
  const passwordHash = await hashPassword(password);
  await db.insert(userCredentials).values({
    userId: newUser.id,
    passwordHash,
  });

  // Generate JWT
  const token = await generateLocalJWT(newUser.id, newUser.primaryEmail!);

  // Audit log - user created
  await auditService.logSuccess("user.created", "user", {
    actorId: newUser.id,
    ipAddress: extractIpAddress(c.req.raw.headers),
  }, {
    resourceId: newUser.id,
    resourceName: newUser.primaryEmail!,
  });

  return c.json({
    user: {
      id: newUser.id,
      email: newUser.primaryEmail,
    },
    token,
    token_type: "Bearer",
  });
});

// ============================================================================
// Local Auth - Login
// ============================================================================

authRoutes.post("/login", async (c) => {
  const body = await c.req.json();
  const { email, password } = body;
  const ipAddress = extractIpAddress(c.req.raw.headers);

  if (!email || !password) {
    throw new BadRequestError("Email and password are required");
  }

  // Find user by email
  const user = await db.query.users.findFirst({
    where: eq(users.primaryEmail, email.toLowerCase()),
  });

  if (!user) {
    // Audit log - failed login (user not found)
    await auditService.logFailure("auth.login_failed", "user", {
      ipAddress,
    }, "User not found", {
      metadata: { email: email.toLowerCase() },
    });
    throw new UnauthorizedError("Invalid email or password");
  }

  // Check if user has local credentials
  const credentials = await db.query.userCredentials.findFirst({
    where: eq(userCredentials.userId, user.id),
  });

  if (!credentials) {
    // Audit log - failed login (OIDC user)
    await auditService.logFailure("auth.login_failed", "user", {
      actorId: user.id,
      ipAddress,
    }, "OIDC account attempted local login", {
      resourceId: user.id,
    });
    throw new UnauthorizedError("This account uses external login (OIDC). Please use the external login option.");
  }

  // Verify password
  const isValid = await verifyPassword(password, credentials.passwordHash);
  if (!isValid) {
    // Audit log - failed login (wrong password)
    await auditService.logFailure("auth.login_failed", "user", {
      actorId: user.id,
      ipAddress,
    }, "Invalid password", {
      resourceId: user.id,
    });
    throw new UnauthorizedError("Invalid email or password");
  }

  // Check if user is disabled
  if (user.disabledAt) {
    // Audit log - failed login (disabled)
    await auditService.logFailure("auth.login_failed", "user", {
      actorId: user.id,
      ipAddress,
    }, "Account disabled", {
      resourceId: user.id,
    });
    throw new UnauthorizedError("This account has been disabled");
  }

  // Generate JWT
  const token = await generateLocalJWT(user.id, user.primaryEmail!);

  // Audit log - successful login
  await auditService.logSuccess("auth.login", "user", {
    actorId: user.id,
    ipAddress,
  }, {
    resourceId: user.id,
    resourceName: user.primaryEmail!,
  });

  return c.json({
    user: {
      id: user.id,
      email: user.primaryEmail,
    },
    token,
    token_type: "Bearer",
  });
});

// ============================================================================
// Local Auth - Change Password
// ============================================================================

authRoutes.post("/change-password", auth(), async (c) => {
  const authContext = c.get("auth");
  const body = await c.req.json();
  const { currentPassword, newPassword } = body;

  // Get user's credentials
  const credentials = await db.query.userCredentials.findFirst({
    where: eq(userCredentials.userId, authContext.user.id),
  });

  if (!credentials) {
    throw new BadRequestError("This account uses external login and cannot change password here");
  }

  // Verify current password
  const isValid = await verifyPassword(currentPassword, credentials.passwordHash);
  if (!isValid) {
    throw new UnauthorizedError("Current password is incorrect");
  }

  // Validate new password
  const passwordValidation = validatePassword(newPassword || "");
  if (!passwordValidation.valid) {
    throw new BadRequestError(passwordValidation.errors.join(". "));
  }

  // Update password
  const newHash = await hashPassword(newPassword);
  await db
    .update(userCredentials)
    .set({
      passwordHash: newHash,
      updatedAt: new Date(),
    })
    .where(eq(userCredentials.userId, authContext.user.id));

  // Audit log - password changed
  await auditService.logSuccess("auth.password_changed", "user", {
    actorId: authContext.user.id,
    ipAddress: extractIpAddress(c.req.raw.headers),
  }, {
    resourceId: authContext.user.id,
  });

  return c.json({ message: "Password updated successfully" });
});

// ============================================================================
// OIDC Login
// ============================================================================

authRoutes.get("/oidc/login", async (c) => {
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();

  // In production, store state/nonce in a secure session
  const authUrl = new URL(`${OIDC_ISSUER}/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", OIDC_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", OIDC_REDIRECT_URI);
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);

  return c.redirect(authUrl.toString());
});

// ============================================================================
// OIDC Callback
// ============================================================================

authRoutes.get("/oidc/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    return c.json({ error, description: c.req.query("error_description") }, 400);
  }

  if (!code) {
    return c.json({ error: "Missing authorization code" }, 400);
  }

  // Exchange code for tokens
  const tokenResponse = await fetch(`${OIDC_ISSUER}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: OIDC_CLIENT_ID,
      client_secret: getEnv("OIDC_CLIENT_SECRET", ""),
      code,
      redirect_uri: OIDC_REDIRECT_URI,
    }),
  });

  if (!tokenResponse.ok) {
    const errorData = await tokenResponse.json();
    return c.json({ error: "Token exchange failed", details: errorData }, 400);
  }

  const tokens = await tokenResponse.json() as {
    access_token: string;
    id_token: string;
    token_type: string;
    expires_in: number;
  };

  // Return tokens to client (in production, set secure cookies or return to frontend)
  return c.json({
    access_token: tokens.access_token,
    id_token: tokens.id_token,
    token_type: tokens.token_type,
    expires_in: tokens.expires_in,
  });
});

// ============================================================================
// Get Current User
// ============================================================================

authRoutes.get("/me", auth(), async (c) => {
  const authContext = c.get("auth");

  // Return flat User object matching frontend expectations
  return c.json({
    id: authContext.user.id,
    email: authContext.user.email || "",
    name: null, // Users table doesn't have name field yet
    avatarUrl: null, // Users table doesn't have avatarUrl field yet
    tenantId: authContext.tenantId || "",
    role: authContext.role || "member",
    isSystemAdmin: authContext.isSystemAdmin,
  });
});

// ============================================================================
// List User's Tenants
// ============================================================================

authRoutes.get("/tenants", auth(), async (c) => {
  const authContext = c.get("auth");

  const memberships = await db
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
        eq(tenantMemberships.userId, authContext.user.id),
        isNull(tenantMemberships.deletedAt),
        isNull(tenants.deletedAt)
      )
    );

  return c.json({
    tenants: memberships.map((m) => ({
      id: m.tenantId,
      name: m.tenantName,
      slug: m.tenantSlug,
      role: m.role,
    })),
  });
});
