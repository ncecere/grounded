import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { getEnv } from "@kcb/shared";

const connectionString = getEnv("DATABASE_URL", "postgresql://localhost:5432/kcb");

// For queries
const queryClient = postgres(connectionString);

// For migrations (single connection)
export const migrationClient = postgres(connectionString, { max: 1 });

export const db = drizzle(queryClient, { schema });

export type Database = typeof db;

// Helper to set tenant context for RLS
export async function withTenantContext<T>(
  tenantId: string,
  fn: () => Promise<T>
): Promise<T> {
  await db.execute(`SET LOCAL app.tenant_id = '${tenantId}'`);
  return fn();
}

// Helper to set system admin context for bypassing RLS
export async function withSystemAdminContext<T>(fn: () => Promise<T>): Promise<T> {
  await db.execute(`SET LOCAL app.is_system_admin = 'true'`);
  return fn();
}
