import { describe, expect, it } from "bun:test";
import type { AuthContext } from "../middleware/auth/types";
import { buildAuditContext } from "./audit";

describe("audit helpers", () => {
  it("builds audit context from auth and headers", () => {
    const headers = new Headers({
      "x-forwarded-for": "192.168.0.1, 10.0.0.1",
    });
    const authContext: AuthContext = {
      user: {
        id: "user-1",
        email: "user@example.com",
        issuer: "local",
        subject: "subject-1",
      },
      tenantId: "tenant-1",
      role: "admin",
      isSystemAdmin: false,
      apiKeyId: null,
    };

    const context = buildAuditContext({ authContext, headers });

    expect(context).toEqual({
      actorId: "user-1",
      tenantId: "tenant-1",
      ipAddress: "192.168.0.1",
    });
  });

  it("allows audit context overrides", () => {
    const headers = new Headers({
      "x-real-ip": "10.0.0.5",
    });
    const authContext: AuthContext = {
      user: {
        id: "user-2",
        email: null,
        issuer: "local",
        subject: "subject-2",
      },
      tenantId: "tenant-2",
      role: "member",
      isSystemAdmin: false,
      apiKeyId: null,
    };

    const context = buildAuditContext({
      authContext,
      headers,
      actorId: "override-user",
      tenantId: "override-tenant",
      ipAddress: "203.0.113.42",
    });

    expect(context).toEqual({
      actorId: "override-user",
      tenantId: "override-tenant",
      ipAddress: "203.0.113.42",
    });
  });

  it("omits tenant when auth context is null", () => {
    const context = buildAuditContext({});

    expect(context).toEqual({
      actorId: undefined,
      tenantId: undefined,
      ipAddress: undefined,
    });
  });
});
