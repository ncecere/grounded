import { db } from "@kcb/db";
import { users, userCredentials, systemAdmins } from "@kcb/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword, getEnv, validateEmail, validatePassword } from "@kcb/shared";

export async function seedSystemAdmin(): Promise<void> {
  const adminEmail = getEnv("ADMIN_EMAIL", "");
  const adminPassword = getEnv("ADMIN_PASSWORD", "");

  // Skip if not configured
  if (!adminEmail || !adminPassword) {
    console.log("[Startup] ADMIN_EMAIL/ADMIN_PASSWORD not set, skipping admin seed");
    return;
  }

  // Validate email
  if (!validateEmail(adminEmail)) {
    console.error("[Startup] Invalid ADMIN_EMAIL format");
    return;
  }

  // Validate password
  const passwordValidation = validatePassword(adminPassword);
  if (!passwordValidation.valid) {
    console.error("[Startup] ADMIN_PASSWORD does not meet requirements:", passwordValidation.errors.join(", "));
    return;
  }

  // Check if user already exists with this email
  const existingUser = await db.query.users.findFirst({
    where: eq(users.primaryEmail, adminEmail.toLowerCase()),
  });

  if (existingUser) {
    // Check if already a system admin
    const existingAdmin = await db.query.systemAdmins.findFirst({
      where: eq(systemAdmins.userId, existingUser.id),
    });

    if (existingAdmin) {
      console.log("[Startup] System admin already exists:", adminEmail);
      return;
    }

    // Promote existing user to system admin
    await db.insert(systemAdmins).values({ userId: existingUser.id });
    console.log("[Startup] Existing user promoted to system admin:", adminEmail);
    return;
  }

  // Create new admin user
  const [newUser] = await db
    .insert(users)
    .values({ primaryEmail: adminEmail.toLowerCase() })
    .returning();

  // Create credentials
  const passwordHash = await hashPassword(adminPassword);
  await db.insert(userCredentials).values({
    userId: newUser.id,
    passwordHash,
  });

  // Create system admin entry
  await db.insert(systemAdmins).values({ userId: newUser.id });

  console.log("[Startup] System admin created:", adminEmail);
}
