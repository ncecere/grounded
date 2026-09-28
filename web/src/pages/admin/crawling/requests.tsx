/* Teams' domain requests (admin): list, approve, deny and revoke. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Inbox } from "lucide-react";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { QueryView } from "@/components/query-view";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Field } from "@/components/ui/field/field";
import { NativeSelect, Textarea } from "@/components/ui/input/input";
import { Table, TableActions, Td, Tr } from "@/components/ui/table/table";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import { formatDate } from "@/lib/format";
import s from "../../shared.module.css";
import { type DomainRequest, type DomainRequestStatus, DomainStatusBadge, domainStatusLabels } from "../../team/domains";

type Decision = Schemas["DomainReview"]["decision"];
type Review = { request: DomainRequest; decision: Decision };

export const adminDomainRequestsKey = ["admin", "domain-requests"];

/** Pending domain requests (the tab count and the admin overview). */
export const pendingDomainRequestsQuery = () => ({
  queryKey: [...adminDomainRequestsKey, "pending"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/domain-requests", { params: { query: { status: "pending" as const } } })),
});

const decisionText: Record<Decision, { verb: string; confirm: string; describe: (r: DomainRequest) => string; done: string }> = {
  approve: {
    verb: "Approve",
    confirm: "Approve request",
    describe: (r) => `${r.teamName}'s web sources can crawl hosts matching ${r.pattern} within 30 seconds.`,
    done: "approved",
  },
  deny: {
    verb: "Deny",
    confirm: "Deny request",
    describe: (r) => `${r.teamName} can't crawl hosts matching ${r.pattern}. The team can see your note.`,
    done: "denied",
  },
  revoke: {
    verb: "Revoke",
    confirm: "Revoke approval",
    describe: (r) => `Crawls by ${r.teamName} stop fetching hosts matching ${r.pattern} on their next page, and new sources for them are refused.`,
    done: "revoked",
  },
};

export function DomainRequestsCard({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<DomainRequestStatus | "">("pending");
  const [reviewing, setReviewing] = useState<Review | null>(null);
  const [note, setNote] = useState("");
  const requests = useQuery({
    queryKey: [...adminDomainRequestsKey, status],
    queryFn: async () => unwrap(await api.GET("/v1/admin/domain-requests", { params: { query: { status: status || undefined } } })),
  });
  const list = requests.data ?? [];
  const review = useMutation({
    mutationFn: async ({ request, decision }: Review) =>
      unwrap(
        await api.POST("/v1/admin/domain-requests/{requestId}/review", {
          params: { path: { requestId: request.id } },
          body: { decision, note: note.trim() || undefined },
        }),
      ),
    onSuccess: (r, { decision }) => {
      setReviewing(null);
      setNote("");
      toast.success(`${r.pattern} was ${decisionText[decision].done}`, r.teamName);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: adminDomainRequestsKey }),
  });
  const open = (request: DomainRequest, decision: Decision) => {
    review.reset();
    setNote("");
    setReviewing({ request, decision });
  };

  return (
    <Card title="Domain requests" description="Teams' requests to crawl hosts outside the allowlist. Pending requests are listed first." flush>
      <div className={s.pad}>
        <Field label="Show" className={s.filter}>
          <NativeSelect size="sm" value={status} onChange={(e) => setStatus(e.target.value as DomainRequestStatus | "")}>
            <option value="">All requests</option>
            {(Object.keys(domainStatusLabels) as DomainRequestStatus[]).map((k) => (
              <option key={k} value={k}>
                {domainStatusLabels[k]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <QueryView
        query={requests}
        loadingLabel="Loading domain requests…"
        empty={
          list.length === 0 && (
            <EmptyState size="compact" icon={<Inbox />} title={status ? `No ${domainStatusLabels[status].toLowerCase()} requests.` : "No domain requests yet."} />
          )
        }
      >
        <RequestsTable list={list} isAdmin={isAdmin} onReview={open} />
      </QueryView>
      <AlertDialog
        open={reviewing !== null}
        onOpenChange={(o) => {
          if (!o) setReviewing(null);
        }}
        title={reviewing ? `${decisionText[reviewing.decision].verb} ${reviewing.request.pattern}?` : "Review request"}
        description={reviewing ? decisionText[reviewing.decision].describe(reviewing.request) : ""}
        confirmLabel={reviewing ? decisionText[reviewing.decision].confirm : "Confirm"}
        tone={reviewing?.decision === "approve" ? "primary" : "danger"}
        busy={review.isPending}
        error={review.error}
        onConfirm={() => reviewing && review.mutate(reviewing)}
      >
        <Field label="Note" labelHint="Optional" description="Recorded in the audit log and shown to the team. Up to 1,000 characters.">
          <Textarea maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </AlertDialog>
    </Card>
  );
}

function RequestsTable({ list, isAdmin, onReview }: { list: DomainRequest[]; isAdmin: boolean; onReview: (r: DomainRequest, d: Decision) => void }) {
  const pending = list.filter((r) => r.status === "pending").length;
  return (
    <Table caption={`Domain requests${pending > 0 ? `, ${pending} pending` : ""}`} columns={["Team", "Host pattern", "Reason", "Requested by", "Status", ""]}>
      {list.map((r) => {
        const who = r.requester;
        return (
          <Tr key={r.id}>
            <Td>
              <TextLink render={<Link to="/admin/teams/$team" params={{ team: r.teamSlug }} />} className={s.primary}>
                {r.teamName}
              </TextLink>
            </Td>
            <Td>
              <code className={`${s.mono} ${s.primary}`}>{r.pattern}</code>
            </Td>
            <Td>{r.reason}</Td>
            <Td>
              {who ? who.displayName || who.email : "Deleted user"}
              {who && <span className={s.secondary}>{who.email}</span>}
              <span className={s.secondary}>{formatDate(r.createdAt)}</span>
            </Td>
            <Td>
              <DomainStatusBadge status={r.status} />
              {r.reviewedAt && (
                <span className={s.secondary}>
                  {r.reviewer ? `${r.reviewer.displayName || r.reviewer.email}, ` : ""}
                  {formatDate(r.reviewedAt)}
                </span>
              )}
              {r.reviewNote && <span className={s.secondary}>“{r.reviewNote}”</span>}
            </Td>
            <Td>
              <TableActions>
                {isAdmin && r.status === "pending" && (
                  <>
                    <Button size="sm" variant="secondary" aria-label={`Approve ${r.pattern} for ${r.teamName}`} onClick={() => onReview(r, "approve")}>
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={`Deny ${r.pattern} for ${r.teamName}`} onClick={() => onReview(r, "deny")}>
                      Deny
                    </Button>
                  </>
                )}
                {isAdmin && r.status === "approved" && (
                  <Button size="sm" variant="ghost" aria-label={`Revoke ${r.pattern} for ${r.teamName}`} onClick={() => onReview(r, "revoke")}>
                    Revoke
                  </Button>
                )}
              </TableActions>
            </Td>
          </Tr>
        );
      })}
    </Table>
  );
}
