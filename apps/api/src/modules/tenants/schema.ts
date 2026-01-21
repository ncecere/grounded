import { z } from "zod";

export const quotaOverridesSchema = z.object({
  maxKbs: z.number().int().min(1).max(1000).optional(),
  maxAgents: z.number().int().min(1).max(1000).optional(),
  maxUploadedDocsPerMonth: z.number().int().min(1).max(100000).optional(),
  maxScrapedPagesPerMonth: z.number().int().min(1).max(100000).optional(),
  maxCrawlConcurrency: z.number().int().min(1).max(50).optional(),
  chatRateLimitPerMinute: z.number().int().min(1).max(1000).optional(),
});

export const createTenantSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  ownerEmail: z.string().email().optional(),
  quotas: quotaOverridesSchema.optional(),
});

export const updateTenantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

export const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["owner", "admin", "member", "viewer"]),
});

export const updateMemberSchema = z.object({
  role: z.enum(["owner", "admin", "member", "viewer"]),
});

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(["chat", "read", "write"])).optional().default(["chat", "read"]),
  expiresAt: z.string().datetime().optional(),
});
