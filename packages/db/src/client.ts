import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { getEnv } from "@grounded/shared";
import { sql } from "drizzle-orm";

const connectionString = getEnv("DATABASE_URL", "postgresql://localhost:5432/grounded");

// For queries
const queryClient = postgres(connectionString);

// For migrations (single connection)
export const migrationClient = postgres(connectionString, { max: 1 });

export const db = drizzle(queryClient, { schema });

export type Database = PostgresJsDatabase<typeof schema>;

// RLS context options
export interface RLSContext {
  tenantId?: string | null;
  userId?: string | null;
  isSystemAdmin?: boolean;
}

/**
 * Execute a function within a transaction with RLS context properly set.
 * SET LOCAL only persists within a transaction, so this is the correct way
 * to use RLS with PostgreSQL.
 */
export async function withRLSContext<T>(
  context: RLSContext,
  fn: (tx: Database) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    // Set RLS context variables within the transaction
    if (context.tenantId) {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${context.tenantId}, true)`);
    }
    if (context.userId) {
      await tx.execute(sql`SELECT set_config('app.user_id', ${context.userId}, true)`);
    }
    if (context.isSystemAdmin) {
      await tx.execute(sql`SELECT set_config('app.is_system_admin', 'true', true)`);
    }
    
    return fn(tx as Database);
  });
}

/**
 * Helper to run a query with tenant context.
 * Wraps the operation in a transaction with SET LOCAL for RLS.
 */
export async function withTenantContext<T>(
  tenantId: string,
  fn: (tx: Database) => Promise<T>
): Promise<T> {
  return withRLSContext({ tenantId }, fn);
}

/**
 * Helper to run a query with system admin context.
 * Wraps the operation in a transaction with SET LOCAL for RLS bypass.
 */
export async function withSystemAdminContext<T>(
  fn: (tx: Database) => Promise<T>
): Promise<T> {
  return withRLSContext({ isSystemAdmin: true }, fn);
}
