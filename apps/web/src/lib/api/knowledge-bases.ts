import { request } from "./client";
import type { KnowledgeBase } from "./types";

export const knowledgeBasesApi = {
  listKnowledgeBases: async () => {
    const res = await request<{ knowledgeBases: KnowledgeBase[] }>("/knowledge-bases");
    return res.knowledgeBases;
  },

  getKnowledgeBase: async (id: string) => {
    const res = await request<{ knowledgeBase: KnowledgeBase }>(`/knowledge-bases/${id}`);
    return res.knowledgeBase;
  },

  createKnowledgeBase: async (data: { name: string; description?: string; embeddingModelId?: string }) => {
    const res = await request<{ knowledgeBase: KnowledgeBase }>("/knowledge-bases", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res.knowledgeBase;
  },

  updateKnowledgeBase: async (id: string, data: { name?: string; description?: string }) => {
    const res = await request<{ knowledgeBase: KnowledgeBase }>(`/knowledge-bases/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    return res.knowledgeBase;
  },

  deleteKnowledgeBase: (id: string) =>
    request<void>(`/knowledge-bases/${id}`, { method: "DELETE" }),

  reindexKnowledgeBase: async (id: string, embeddingModelId: string) => {
    const res = await request<{ message: string; knowledgeBase: KnowledgeBase }>(
      `/knowledge-bases/${id}/reindex`,
      {
        method: "POST",
        body: JSON.stringify({ embeddingModelId }),
      }
    );
    return res;
  },

  cancelKbReindex: async (id: string) => {
    const res = await request<{ message: string; knowledgeBase: KnowledgeBase }>(
      `/knowledge-bases/${id}/reindex/cancel`,
      { method: "POST" }
    );
    return res;
  },
};
