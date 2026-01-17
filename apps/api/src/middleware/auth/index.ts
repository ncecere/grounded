/**
 * Auth Middleware Module
 *
 * This module provides authentication and authorization middleware for the API.
 * It is split into focused submodules:
 *
 * - types.ts      - Type definitions (AuthUser, AuthContext)
 * - helpers.ts    - Shared utility functions (withRequestRLS, checkSystemAdmin, etc.)
 * - bearer.ts     - Local JWT bearer token authentication
 * - oidc.ts       - OIDC/external provider authentication
 * - api-key.ts    - Tenant-scoped API key authentication
 * - admin-token.ts - System-level admin token authentication
 * - middleware.ts - Main auth middleware and RBAC middleware
 */

// Re-export types
export type { AuthUser, AuthContext, RLSContext, Database } from "./types";

// Re-export helpers
export { withRequestRLS, checkSystemAdmin, findOrCreateUser } from "./helpers";

// Re-export authentication functions (for testing or direct use)
export { authenticateLocalJWT, LOCAL_JWT_ISSUER, LOCAL_JWT_AUDIENCE } from "./bearer";
export { authenticateOIDC, isOIDCConfigured, getJWKS } from "./oidc";
export { authenticateApiKey } from "./api-key";
export { authenticateAdminToken } from "./admin-token";

// Re-export middleware (main exports)
export { auth, requireRole, requireSystemAdmin, requireTenant } from "./middleware";
