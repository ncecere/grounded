import type { Database } from "@grounded/db";
import { tenants, users } from "@grounded/db/schema";
import { inArray } from "drizzle-orm";

export async function fetchAuditActorsByIds(tx: Database, actorIds: string[]) {
  if (actorIds.length === 0) {
    return [];
  }

  return tx
    .select({ id: users.id, email: users.primaryEmail })
    .from(users)
    .where(inArray(users.id, actorIds));
}

export async function fetchAuditTenantsByIds(tx: Database, tenantIds: string[]) {
  if (tenantIds.length === 0) {
    return [];
  }

  return tx
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(inArray(tenants.id, tenantIds));
}

export async function fetchAuditTenantOptions(tx: Database) {
  return tx
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .orderBy(tenants.name);
}
