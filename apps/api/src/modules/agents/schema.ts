import { z } from "zod";
import { widgetThemeSchema } from "@grounded/shared";

export const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  welcomeMessage: z.string().max(200).optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  systemPrompt: z.string().max(4000).optional(),
  rerankerEnabled: z.boolean().default(true),
  citationsEnabled: z.boolean().default(true),
  ragType: z.enum(["simple", "advanced"]).default("simple"),
  showReasoningSteps: z.boolean().default(true),
  kbIds: z.array(z.string().uuid()).optional(),
  llmModelConfigId: z.string().uuid().optional(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  welcomeMessage: z.string().max(200).optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  systemPrompt: z.string().max(4000).optional(),
  rerankerEnabled: z.boolean().optional(),
  citationsEnabled: z.boolean().optional(),
  ragType: z.enum(["simple", "advanced"]).optional(),
  showReasoningSteps: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
  llmModelConfigId: z.string().uuid().nullable().optional(),
  kbIds: z.array(z.string().uuid()).optional(),
});

export const updateKbsSchema = z.object({
  kbIds: z.array(z.string().uuid()),
});

export const updateRetrievalConfigSchema = z.object({
  topK: z.number().int().min(1).max(50).optional(),
  candidateK: z.number().int().min(1).max(200).optional(),
  maxCitations: z.number().int().min(1).max(20).optional(),
  rerankerEnabled: z.boolean().optional(),
  rerankerType: z.enum(["heuristic", "cross_encoder"]).optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
  historyTurns: z.number().int().min(1).max(20).optional(),
  advancedMaxSubqueries: z.number().int().min(1).max(5).optional(),
});

export const updateWidgetConfigSchema = z.object({
  isPublic: z.boolean().optional(),
  allowedDomains: z.array(z.string()).optional(),
  oidcRequired: z.boolean().optional(),
  theme: widgetThemeSchema.partial().optional(),
});

export const createChatEndpointSchema = z.object({
  name: z.string().max(100).optional(),
  endpointType: z.enum(["api", "hosted"]).default("api"),
});

export const createWidgetTokenSchema = z.object({
  name: z.string().optional(),
});
