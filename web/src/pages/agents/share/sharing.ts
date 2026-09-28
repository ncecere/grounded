/* The agent's sharing view: audience options (allowed or why not), links and the widget. */
import { queryOptions } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../../../api/client";

export type Sharing = Schemas["AgentSharing"];
export type Audience = Schemas["Audience"];

export const sharingQuery = (team: string, agentId: string) =>
  queryOptions({
    queryKey: ["team", team, "agent", agentId, "sharing"],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/agents/{agentId}/sharing", { params: { path: { team, agentId } } })),
  });

export const audienceLabels: Record<Audience, { label: string; description: string }> = {
  team: { label: "Team members", description: "Only members of this team, signed in." },
  all_authenticated: { label: "Signed-in users", description: "Anyone who can sign in, from any team. Listed in Discover agents." },
  public: { label: "Public", description: "Anyone, without signing in: a public page and the widget on sites you allow." },
};
