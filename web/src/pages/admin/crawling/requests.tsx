/* Teams' domain requests (admin): the shared list and record pages, with approve, deny and revoke. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { Alert } from "@/components/ui/alert/alert";
import { Card } from "@/components/ui/card/card";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Field } from "@/components/ui/field/field";
import { Textarea } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import { type Decision, DomainRequestList } from "../../team/domain-request-list";
import { type DomainRequest } from "../../team/domains";
import { allowlistQuery } from "./allowlist";

type Review = { request: DomainRequest; decision: Decision };

/** Whether host pattern `a` allows every host `b` allows (internal/web Covers). */
export function covers(a: string, b: string): boolean {
  const match = (pattern: string, host: string) =>
    pattern === "*" || (pattern.startsWith("*.") ? host === pattern.slice(2) || host.endsWith(`.${pattern.slice(2)}`) : host === pattern);
  if (a === "*") return true;
  if (b === "*") return false;
  if (b.startsWith("*.")) return a.startsWith("*.") && match(a, b.slice(2));
  return match(a, b);
}

/** Pending requests the allowlist already covers, with the pattern that does (AD-26). */
export function alreadyAllowed(requests: DomainRequest[], allowlist: string[]) {
  return requests.flatMap((r) => {
    const by = r.status === "pending" ? allowlist.find((p) => covers(p, r.pattern)) : undefined;
    return by ? [{ request: r, by }] : [];
  });
}

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
  const [reviewing, setReviewing] = useState<Review | null>(null);
  const [note, setNote] = useState("");
  const requests = useQuery({
    queryKey: [...adminDomainRequestsKey, "all"],
    queryFn: async () => unwrap(await api.GET("/v1/admin/domain-requests")),
  });
  const allowlist = useQuery(allowlistQuery());
  const covered = alreadyAllowed(requests.data ?? [], (allowlist.data ?? []).map((e) => e.pattern));
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
    <Card title="Domain requests" description="Teams' requests to crawl hosts outside the allowlist. Pending requests are listed first.">
      {covered.length > 0 && (
        <Alert tone="info" title={covered.length === 1 ? "1 pending request is already allowed" : `${covered.length} pending requests are already allowed`}>
          {covered.map((c) => `${c.request.pattern} (${c.request.teamName}) is covered by ${c.by} on the allowlist.`).join(" ")} Approving changes nothing
          while that pattern stays; deny with a note to say so.
        </Alert>
      )}
      <DomainRequestList
        list={requests.data ?? []}
        loading={requests.isLoading}
        error={requests.error}
        onRetry={() => void requests.refetch()}
        admin={{ onReview: isAdmin ? open : undefined }}
      />
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
