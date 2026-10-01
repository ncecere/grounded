/* Reranking (docs/v0.4.0.md §3): whether the platform has a rerank model, for the agent's settings, Try it and evaluations. */
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";

export function useRerankStatus() {
  return useQuery({
    queryKey: ["rerank", "status"],
    queryFn: async () => unwrap(await api.GET("/v1/rerank/status")),
    staleTime: 60_000,
  });
}

/** A rerank score as people read it: 0.873. */
export const rerankScore = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
