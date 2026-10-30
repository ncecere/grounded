/* In-app team requests (v0.6.0, E3): the shared types, queries and the status badge, for the person's page and the admins' queue. */
import { StatusBadge } from "@/components/ui/badge/badge";
import type { Schemas } from "@/api/client";
import { api, unwrap } from "@/api/client";

export type TeamRequest = Schemas["TeamRequest"];
export type AdminTeamRequest = Schemas["AdminTeamRequest"];
export type TeamRequestStatus = Schemas["TeamRequestStatus"];

export const myTeamRequestsKey = ["team-requests", "mine"];
export const myTeamRequestsQuery = () => ({
  queryKey: myTeamRequestsKey,
  queryFn: async () => unwrap(await api.GET("/v1/team-requests")),
});

export const adminTeamRequestsKey = ["admin", "team-requests"];
export const adminTeamRequestsQuery = () => ({
  queryKey: adminTeamRequestsKey,
  queryFn: async () => unwrap(await api.GET("/v1/admin/team-requests")),
});

export const statusLabels: Record<TeamRequestStatus, string> = {
  pending: "Waiting for review",
  approved: "Approved",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

const tones = { pending: "info", approved: "success", declined: "danger", withdrawn: "neutral" } as const;

export function RequestStatusBadge({ status }: { status: TeamRequestStatus }) {
  return <StatusBadge tone={tones[status]}>{statusLabels[status]}</StatusBadge>;
}

/** The level a team request stands at: what the reviewer approved once approved (they may change it), what was asked for until then. */
export const standingClassification = (r: Pick<TeamRequest, "status" | "classification" | "approvedClassification">) =>
  r.status === "approved" && r.approvedClassification ? r.approvedClassification : r.classification;
