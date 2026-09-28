/* Teams' domain requests (admin): the shared list and record pages, with approve, deny and revoke. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { Card } from "@/components/ui/card/card";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Field } from "@/components/ui/field/field";
import { Textarea } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import { type Decision, DomainRequestList } from "../../team/domain-request-list";
import { type DomainRequest } from "../../team/domains";

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
  const [reviewing, setReviewing] = useState<Review | null>(null);
  const [note, setNote] = useState("");
  const requests = useQuery({
    queryKey: [...adminDomainRequestsKey, "all"],
    queryFn: async () => unwrap(await api.GET("/v1/admin/domain-requests")),
  });
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
