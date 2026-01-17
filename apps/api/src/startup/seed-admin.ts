import { db } from "@grounded/db";
import { users, userCredentials, systemAdmins } from "@grounded/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword, getEnv, validateEmail, validatePassword } from "@grounded/shared";
import { log } from "@grounded/logger";

export async function seedSystemAdmin(): Promise<void> {
  const adminEmail = getEnv("ADMIN_EMAIL", "");
  const adminPassword = getEnv("ADMIN_PASSWORD", "");

  // Skip if not configured
  if (!adminEmail || !adminPassword) {
    log.info("api", "ADMIN_EMAIL/ADMIN_PASSWORD not set, skipping admin seed");
    return;
  }

  // Validate email
  if (!validateEmail(adminEmail)) {
    log.error("api", "Invalid ADMIN_EMAIL format");
    return;
  }

  // Validate password
  const passwordValidation = validatePassword(adminPassword);
  if (!passwordValidation.valid) {
    log.error("api", "ADMIN_PASSWORD does not meet requirements", { errors: passwordValidation.errors });
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
      log.info("api", "System admin already exists", { email: adminEmail });
      return;
    }

    // Promote existing user to system admin
    await db.insert(systemAdmins).values({ userId: existingUser.id });
    log.info("api", "Existing user promoted to system admin", { email: adminEmail });
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

  log.info("api", "System admin created", { email: adminEmail });
}
