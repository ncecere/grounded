import { migrationClient } from "@grounded/db";
import { getEnv } from "@grounded/shared";
import { log } from "@grounded/logger";
import { readdir } from "fs/promises";
import { join } from "path";

interface MigrationRecord {
  id: number;
  name: string;
  applied_at: Date;
}

/**
 * Find the migrations directory, trying multiple possible locations.
 */
async function findMigrationsDir(): Promise<string | null> {
  const possiblePaths = [
    join(process.cwd(), "migrations"),           // Running from project root
    join(process.cwd(), "../../migrations"),     // Running from apps/api
    join(import.meta.dir, "../../../../migrations"), // Relative to this file
  ];

  for (const dir of possiblePaths) {
    try {
      await readdir(dir);
      return dir;
    } catch {
      // Try next path
    }
  }
  return null;
}

/**
 * Run all pending database migrations automatically at startup.
 * Migrations are tracked in the `schema_migrations` table.
 *
 * Set SKIP_MIGRATIONS=true to disable automatic migrations.
 */
export async function runMigrations(): Promise<void> {
  // Check if migrations should be skipped
  const skipMigrations = getEnv("SKIP_MIGRATIONS", "false").toLowerCase() === "true";
  if (skipMigrations) {
    log.info("api", "Skipping migrations (SKIP_MIGRATIONS=true)");
    return;
  }

  log.info("api", "Checking for pending migrations...");

  try {
    // Create migrations tracking table if it doesn't exist
    await migrationClient`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    // Get list of applied migrations
    const applied = await migrationClient<MigrationRecord[]>`
      SELECT name FROM schema_migrations ORDER BY name
    `;
    const appliedSet = new Set(applied.map((m) => m.name));

    // Find migrations directory
    const migrationsDir = await findMigrationsDir();
    if (!migrationsDir) {
      log.info("api", "No migrations directory found, skipping");
      return;
    }

    log.debug("api", "Using migrations directory", { migrationsDir });

    const files = await readdir(migrationsDir);

    // Filter to .sql files and sort by name
    const sqlFiles = files
      .filter((f) => f.endsWith(".sql"))
      .sort();

    // Find pending migrations
    const pending = sqlFiles.filter((f) => !appliedSet.has(f));

    if (pending.length === 0) {
      log.info("api", "Database is up to date");
      return;
    }

    log.info("api", `Found ${pending.length} pending migration(s)`, { pending });

    // Apply each pending migration
    for (const filename of pending) {
      log.info("api", `Applying migration: ${filename}`);

      const filepath = join(migrationsDir, filename);

      try {
        // Execute using postgres file() method which handles multi-statement SQL
        await migrationClient.file(filepath);

        // Record migration as applied
        await migrationClient`
          INSERT INTO schema_migrations (name) VALUES (${filename})
        `;

        log.info("api", `Applied migration: ${filename}`);
      } catch (error) {
        log.error("api", `Failed to apply migration: ${filename}`, { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }

    log.info("api", `Successfully applied ${pending.length} migration(s)`);
  } catch (error) {
    log.error("api", "Migration failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
