import { z } from "zod";
import { expectedBehaviorSchema } from "../../services/test-suite-import";

export const scheduleTypeSchema = z.enum(["manual", "hourly", "daily", "weekly"]);
export const scheduleTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Schedule time must be HH:MM in 24-hour format");

export const createTestSuiteSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  scheduleType: scheduleTypeSchema.default("manual"),
  scheduleTime: scheduleTimeSchema.nullable().optional(),
  scheduleDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  llmJudgeModelConfigId: z.string().uuid().nullable().optional(),
  alertOnRegression: z.boolean().default(true),
  alertThresholdPercent: z.number().int().min(1).max(100).default(10),
  isEnabled: z.boolean().default(true),
});

export const updateTestSuiteSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  scheduleType: scheduleTypeSchema.optional(),
  scheduleTime: scheduleTimeSchema.nullable().optional(),
  scheduleDayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  llmJudgeModelConfigId: z.string().uuid().nullable().optional(),
  alertOnRegression: z.boolean().optional(),
  alertThresholdPercent: z.number().int().min(1).max(100).optional(),
  promptAnalysisEnabled: z.boolean().optional(),
  abTestingEnabled: z.boolean().optional(),
  analysisModelConfigId: z.string().uuid().nullable().optional(),
  manualCandidatePrompt: z.string().max(8000).nullable().optional(),
  isEnabled: z.boolean().optional(),
});

export const createTestCaseSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  question: z.string().min(1).max(4000),
  expectedBehavior: expectedBehaviorSchema,
  sortOrder: z.number().int().min(0).optional(),
  isEnabled: z.boolean().default(true),
});

export const updateTestCaseSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  question: z.string().min(1).max(4000).optional(),
  expectedBehavior: expectedBehaviorSchema.optional(),
  sortOrder: z.number().int().min(0).optional(),
  isEnabled: z.boolean().optional(),
});

export const reorderTestCasesSchema = z.object({
  caseIds: z.array(z.string().uuid()).min(1),
});

export const listRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const startExperimentWithPromptSchema = z.object({
  candidatePrompt: z.string().min(1).max(16000),
});

export const listExperimentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
});

export const listAnalysesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
