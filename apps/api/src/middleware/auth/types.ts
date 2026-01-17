import type { Database, RLSContext } from "@grounded/db";

// ============================================================================
// Types
// ============================================================================

export interface AuthUser {
  id: string;
  email: string | null;
  issuer: string;
  subject: string;
}

export interface AuthContext {
  user: AuthUser;
  tenantId: string | null;
  role: string | null;
  isSystemAdmin: boolean;
  apiKeyId: string | null;
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
    requestId: string;
    rlsContext: RLSContext;
  }
}

export type { Database, RLSContext };
