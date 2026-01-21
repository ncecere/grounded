import { z } from "zod";
import { sourceConfigSchema } from "@grounded/shared";

export const createSourceBaseSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["web", "upload"]),
  config: sourceConfigSchema,
  enrichmentEnabled: z.boolean().default(false),
});

export const createSourceWithKbIdSchema = createSourceBaseSchema.extend({
  kbId: z.string().uuid(),
});

export const updateSourceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: sourceConfigSchema.partial().optional(),
  enrichmentEnabled: z.boolean().optional(),
});

export const triggerRunSchema = z.object({
  forceReindex: z.boolean().optional().default(false),
});

export type CreateSourceBase = z.infer<typeof createSourceBaseSchema>;
export type CreateSourceWithKbId = z.infer<typeof createSourceWithKbIdSchema>;
export type UpdateSource = z.infer<typeof updateSourceSchema>;
export type TriggerRunInput = z.infer<typeof triggerRunSchema>;
