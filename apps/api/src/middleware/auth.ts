/**
 * Auth Middleware
 *
 * This file re-exports the auth middleware from the modular auth/ directory.
 * The auth system is split into focused modules for maintainability:
 *
 * - auth/types.ts      - Type definitions
 * - auth/helpers.ts    - Shared utilities
 * - auth/bearer.ts     - Local JWT authentication
 * - auth/oidc.ts       - OIDC authentication
 * - auth/api-key.ts    - Tenant API key authentication
 * - auth/admin-token.ts - Admin token authentication
 * - auth/middleware.ts - Main middleware and RBAC
 *
 * See auth/index.ts for the full list of exports.
 */

export * from "./auth/index";
