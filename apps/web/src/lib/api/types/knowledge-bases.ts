import type { KnowledgeBase as SharedKnowledgeBase } from "@grounded/shared/types/api";

export interface KnowledgeBase extends SharedKnowledgeBase {
  sourceCount?: number;
  chunkCount?: number;
  isShared?: boolean;
  embeddingModelId?: string | null;
  embeddingDimensions?: number;
  reindexStatus?: "pending" | "in_progress" | "failed" | null;
  reindexProgress?: number | null;
  reindexError?: string | null;
  pendingEmbeddingModelId?: string | null;
  pendingEmbeddingDimensions?: number | null;
  reindexStartedAt?: string | null;
  updatedAt: string;
}
