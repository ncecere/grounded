import { z } from "zod";

export const updateSettingSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const updateSettingsSchema = z.object({
  settings: z.array(
    z.object({
      key: z.string(),
      value: z.union([z.string(), z.number(), z.boolean()]),
    })
  ),
});

export const testEmailSchema = z.object({
  email: z.string().email(),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().optional(),
  isSystemAdmin: z.boolean().optional().default(false),
});

export const updateUserSchema = z.object({
  isSystemAdmin: z.boolean().optional(),
  disabled: z.boolean().optional(),
});

export const createTokenSchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.string().datetime().optional(),
});

const providerTypes = ["openai", "anthropic", "google", "openai-compatible"] as const;
const modelTypes = ["chat", "embedding"] as const;

export const createProviderSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Must be lowercase alphanumeric with hyphens"),
  displayName: z.string().min(1).max(200),
  type: z.enum(providerTypes),
  baseUrl: z.string().url().nullable().optional(),
  apiKey: z.string().min(1),
  isEnabled: z.boolean().optional().default(true),
});

export const updateProviderSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  type: z.enum(providerTypes).optional(),
  baseUrl: z.string().url().nullable().optional(),
  apiKey: z.string().min(1).optional(),
  isEnabled: z.boolean().optional(),
});

export const createModelSchema = z.object({
  providerId: z.string().uuid(),
  modelId: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  modelType: z.enum(modelTypes),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  supportsStreaming: z.boolean().optional().default(true),
  supportsTools: z.boolean().optional().default(false),
  dimensions: z.number().int().positive().optional().nullable(),
  isEnabled: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
});

export const updateModelSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  supportsStreaming: z.boolean().optional(),
  supportsTools: z.boolean().optional(),
  dimensions: z.number().int().positive().optional().nullable(),
  isEnabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export const auditQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const createGlobalKbSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  embeddingModelId: z.string().uuid().optional(),
});

export const updateGlobalKbSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

export const shareWithTenantSchema = z.object({
  tenantId: z.string().uuid(),
});
