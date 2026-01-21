import { z } from "zod";

export const createKbSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  embeddingModelId: z.string().uuid().optional(),
});

export const updateKbSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
});

export const reindexKbSchema = z.object({
  embeddingModelId: z.string().uuid(),
});
