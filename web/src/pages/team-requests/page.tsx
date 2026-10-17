/*
 * Request a team (v0.6.0, E3): the person's own requests and a button to ask for another. The platform switch (Admin → Settings → Features)
 * is off by default; while it is off, or the person may not ask (an SSO group) or has as many open requests as allowed, the page says why and
 * keeps the requests they already have.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Plus, Undo2, UsersRound } from "lucide-react";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { ListPage, RelativeTime } from "@/components/templates/list-page";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { toast } from "@/components/ui/toast/toast";
import { useJoinTeamHelp } from "@/components/layout/join-team";
import { useCurrentUser } from "@/session";
import { ClassificationBadge, useClassificationLevels } from "../team/common";
import { type TeamRequest, RequestStatusBadge, myTeamRequestsKey, myTeamRequestsQuery } from "./common";
import { NewRequestDialog } from "./new-request-dialog";

/** The team of an approved request is the person's own to open unless they named someone else as its owner (then they are not on it). */
const isMyTeam = (r: TeamRequest, myEmail: string) => !r.ownerEmail || r.ownerEmail.toLowerCase() === myEmail.toLowerCase();

function columns(levels: ReturnType<typeof useClassificationLevels>["data"], myEmail: string): DataTableColumn<TeamRequest>[] {
  return [
    { id: "name", header: "Team", accessor: "name", sortable: true, rowHeader: true, hideable: false, cell: (r) => <CellText primary={r.name} secondary={r.purpose} /> },
    { id: "status", header: "Status", accessor: "status", sortable: true, cell: (r) => <RequestStatusBadge status={r.status} /> },
    { id: "classification", header: "Classification", accessor: "classification", cell: (r) => <ClassificationBadge levels={levels} value={r.classification} /> },
    { id: "owner", header: "Owner", accessor: (r) => r.ownerEmail, muted: true, defaultHidden: true, cell: (r) => r.ownerEmail || "You" },
    { id: "requested", header: "Requested", accessor: "createdAt", sortable: true, muted: true, cell: (r) => <RelativeTime value={r.createdAt} /> },
    {
      id: "outcome",
      header: "Outcome",
      accessor: (r) => r.decisionReason || r.teamName,
      cell: (r) =>
        r.status === "approved" && r.teamSlug && isMyTeam(r, myEmail) ? (
          <Link to="/teams/$team" params={{ team: r.teamSlug }}>
            Open {r.teamName}
          </Link>
        ) : r.status === "approved" ? (
          <CellText primary="Approved" secondary={`Owned by ${r.ownerEmail}`} />
        ) : r.status === "declined" ? (
          <CellText primary="Declined" secondary={r.decisionReason} />
        ) : (
          "—"
        ),
    },
  ];
}

export function TeamRequestsPage() {
  const qc = useQueryClient();
  const levels = useClassificationLevels();
  const { user } = useCurrentUser();
  const mine = useQuery(myTeamRequestsQuery());
  const help = useJoinTeamHelp();
  const [asking, setAsking] = useState(false);
  const [withdrawing, setWithdrawing] = useState<TeamRequest | null>(null);
  const withdraw = useMutation({
    mutationFn: async (r: TeamRequest) => unwrap(await api.POST("/v1/team-requests/{requestId}/withdraw", { params: { path: { requestId: r.id } } })),
    onSuccess: (_, r) => {
      setWithdrawing(null);
      toast.success(`"${r.name}" was withdrawn`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: myTeamRequestsKey }),
  });
  const m = mine.data;
  const ask = (
    <Button onClick={() => setAsking(true)} disabled={!m?.canAsk}>
      <Plus aria-hidden /> New request
    </Button>
  );
  return (
    <>
      <ListPage<TeamRequest>
        id="team-requests"
        title="Request a team"
        description="Teams own data sources, knowledge bases and agents. A platform admin reviews each request and tells you the decision."
        primaryAction={ask}
        notices={<Notices m={m} help={help} />}
        caption="Your team requests"
        columns={columns(levels.data, user.email)}
        data={m?.items ?? []}
        getRowId={(r) => r.id}
        rowLabel={(r) => r.name}
        search={{ label: "Search your requests", placeholder: "Name or purpose" }}
        loading={mine.isLoading}
        error={mine.error}
        onRetry={() => void mine.refetch()}
        rowActions={(r) => [
          { label: "Open team", icon: <UsersRound aria-hidden />, hidden: !(r.status === "approved" && r.teamSlug && isMyTeam(r, user.email)), render: <Link to="/teams/$team" params={{ team: r.teamSlug }} /> },
          { label: "Withdraw…", icon: <Undo2 aria-hidden />, danger: true, hidden: r.status !== "pending", onSelect: () => setWithdrawing(r) },
        ]}
        empty={{ icon: <UsersRound />, title: "You haven't asked for a team.", description: m?.canAsk ? "Use New request to ask for one." : undefined }}
      />
      {asking && <NewRequestDialog onClose={() => setAsking(false)} />}
      <AlertDialog
        open={withdrawing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setWithdrawing(null);
            withdraw.reset();
          }
        }}
        title={`Withdraw "${withdrawing?.name ?? "this request"}"?`}
        description="The platform admins will no longer see it. You can ask again afterwards."
        confirmLabel="Withdraw request"
        busy={withdraw.isPending}
        error={withdraw.error}
        onConfirm={() => withdrawing && withdraw.mutate(withdrawing)}
      />
    </>
  );
}

/** Why the person cannot ask now, in words, and where else to go when the feature is off. */
function Notices({ m, help }: { m: Schemas["TeamRequestsOverview"] | undefined; help: ReturnType<typeof useJoinTeamHelp> }) {
  if (!m || m.canAsk) return null;
  if (m.blocked === "off") {
    return (
      <Alert tone="info" title="Team requests aren't turned on here">
        {help.text}{" "}
        {help.link && "href" in help.link && (
          <a href={help.link.href} target="_blank" rel="noreferrer">
            {help.link.label} <ExternalLink aria-hidden size={14} />
          </a>
        )}
      </Alert>
    );
  }
  if (m.blocked === "group") return <Alert tone="info">Your account isn't allowed to request a team. Ask a platform admin.</Alert>;
  return (
    <Alert tone="info" title="You have as many open requests as allowed">
      You have {m.openCount} open {m.openCount === 1 ? "request" : "requests"} (the most allowed is {m.maxOpen}). Wait for one to be decided, or withdraw one.
    </Alert>
  );
}
