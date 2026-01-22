export interface KnowledgeBase {
  id: string;
  tenantId: string | null;
  name: string;
  description: string | null;
  sourceCount?: number;
  chunkCount?: number;
  isShared?: boolean;
  isGlobal?: boolean;
  embeddingModelId?: string | null;
  embeddingDimensions?: number;
  reindexStatus?: "pending" | "in_progress" | "failed" | null;
  reindexProgress?: number | null;
  reindexError?: string | null;
  pendingEmbeddingModelId?: string | null;
  pendingEmbeddingDimensions?: number | null;
  reindexStartedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
