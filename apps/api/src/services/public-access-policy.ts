import type { Context } from "hono";
import { verifyPublicUserBearerToken } from "./public-user-auth";

export interface PublicAccessPolicy {
  isPublic: boolean;
  allowedDomains: string[];
  oidcRequired: boolean;
  requiredTenantId?: string;
}

function toHost(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("*.")) {
    return trimmed.toLowerCase();
  }

  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function domainMatches(host: string, allowedDomain: string): boolean {
  const normalized = allowedDomain.trim().toLowerCase();
  if (!normalized) return false;

  const wildcardPrefix = "*.";
  if (normalized.startsWith(wildcardPrefix)) {
    const suffix = normalized.slice(wildcardPrefix.length);
    return host === suffix || host.endsWith(`.${suffix}`);
  }

  return host === normalized || host.endsWith(`.${normalized}`);
}

function getRequestHost(c: Context): string | null {
  const origin = c.req.header("Origin");
  if (origin) {
    const host = toHost(origin);
    if (host) return host;
  }

  const referer = c.req.header("Referer");
  if (referer) {
    const host = toHost(referer);
    if (host) return host;
  }

  return null;
}

export function getClientIp(c: Context): string {
  const forwardedFor = c.req.header("X-Forwarded-For");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }
  return c.req.header("X-Real-IP") || "unknown";
}

export async function enforcePublicAccessPolicy(
  c: Context,
  policy: PublicAccessPolicy
): Promise<Response | null> {
  if (!policy.isPublic) {
    return c.json(
      {
        error: "FORBIDDEN",
        message: "Public access is disabled for this agent",
      },
      403
    );
  }

  const requiresDomainCheck = policy.allowedDomains.length > 0;
  if (requiresDomainCheck) {
    const requestHost = getRequestHost(c);
    if (!requestHost) {
      return c.json(
        {
          error: "FORBIDDEN",
          message: "Origin is required for this endpoint",
        },
        403
      );
    }

    const allowed = policy.allowedDomains.some((domain) => {
      const parsed = toHost(domain);
      if (!parsed) return false;
      return domainMatches(requestHost, parsed);
    });

    if (!allowed) {
      return c.json(
        {
          error: "FORBIDDEN",
          message: "Origin is not allowed for this endpoint",
        },
        403
      );
    }
  }

  if (policy.oidcRequired) {
    try {
      await verifyPublicUserBearerToken(
        c.req.header("Authorization"),
        policy.requiredTenantId
      );
    } catch {
      return c.json(
        {
          error: "UNAUTHORIZED",
          message: "OIDC authentication required",
        },
        401
      );
    }
  }

  return null;
}
