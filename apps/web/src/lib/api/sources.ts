import { API_BASE, request, getToken, getCurrentTenantId } from "./client";
import type { Source, SourceRun } from "./types/sources";

export const sourcesApi = {
  listSources: async (kbId: string) => {
    const res = await request<{ sources: Source[] }>(`/sources/kb/${kbId}`);
    return res.sources;
  },

  getSource: async (_kbId: string, id: string) => {
    const res = await request<{ source: Source }>(`/sources/${id}`);
    return res.source;
  },

  createSource: async (
    kbId: string,
    data: { name: string; type: string; config: Record<string, unknown> }
  ) => {
    const res = await request<{ source: Source }>(`/sources`, {
      method: "POST",
      body: JSON.stringify({ ...data, kbId }),
    });
    return res.source;
  },

  updateSource: async (
    _kbId: string,
    id: string,
    data: { name?: string; config?: Record<string, unknown>; status?: string }
  ) => {
    const res = await request<{ source: Source }>(`/sources/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    return res.source;
  },

  deleteSource: (_kbId: string, id: string) =>
    request<void>(`/sources/${id}`, { method: "DELETE" }),

  triggerSourceRun: async (_kbId: string, id: string, options?: { forceReindex?: boolean }) => {
    const res = await request<{ run: SourceRun }>(`/sources/${id}/runs`, {
      method: "POST",
      body: JSON.stringify({ forceReindex: options?.forceReindex ?? false }),
    });
    return res.run;
  },

  cancelSourceRun: async (_kbId: string, runId: string) => {
    const res = await request<{ run: SourceRun }>(`/sources/runs/${runId}/cancel`, {
      method: "POST",
    });
    return res.run;
  },

  listSourceRuns: async (_kbId: string, id: string) => {
    const res = await request<{ runs: SourceRun[] }>(`/sources/${id}/runs`);
    return res.runs;
  },

  getSourceStats: async (_kbId: string, id: string) => {
    const res = await request<{ stats: { pageCount: number; chunkCount: number } }>(`/sources/${id}/stats`);
    return res.stats;
  },

  // Uploads
  uploadFile: async (kbId: string, file: File, options?: { sourceName?: string; sourceId?: string }) => {
    const token = getToken();
    const tenantId = getCurrentTenantId();
    const headers: Record<string, string> = {};

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    if (tenantId) {
      headers["X-Tenant-ID"] = tenantId;
    }

    const formData = new FormData();
    formData.append("file", file);
    if (options?.sourceName) {
      formData.append("sourceName", options.sourceName);
    }
    if (options?.sourceId) {
      formData.append("sourceId", options.sourceId);
    }
    const response = await fetch(
      `${API_BASE}/uploads/kb/${kbId}`,
      {
        method: "POST",
        body: formData,
        headers,
        credentials: "include",
      }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "Upload failed" }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }
    return response.json();
  },
};
