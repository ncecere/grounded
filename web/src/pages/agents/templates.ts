/* Agent templates (v0.6.0, C4): starting points for a new agent, offered when making one. */
import { useQuery } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../../api/client";

export type AgentTemplate = Schemas["AgentTemplate"];

export const agentTemplatesKey = ["agent-templates"];

/** The built-in templates and the saved ones (403 for anyone who can't make an agent: then there are none to offer). */
export function useAgentTemplates() {
  return useQuery({
    queryKey: agentTemplatesKey,
    queryFn: async () => unwrap(await api.GET("/v1/agent-templates")),
    staleTime: 60_000,
    retry: false,
  });
}
