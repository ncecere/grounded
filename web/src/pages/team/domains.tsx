/* Domain requests: a team asks platform admins to allow crawling a host outside the allowlist. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { api, unwrap, type Schemas } from "../../api/client";
import { useIntent } from "../../lib/intents";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { StatusBadge } from "@/components/ui/badge/badge";
import { terms } from "@/lib/terms";
import { Button } from "@/components/ui/button/button";
import { Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { Field, Form } from "@/components/ui/field/field";
import { Input, Textarea } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { toast } from "@/components/ui/toast/toast";
import type { Tone } from "@/lib/bitop-utils";
import s from "../shared.module.css";
import { useTeam } from "./common";
import { ArchivedNotice } from "./layout";
import { DomainRequestList } from "./domain-request-list";

export type DomainRequest = Schemas["DomainRequest"];
export type DomainRequestStatus = Schemas["DomainRequestStatus"];

export const domainRequestsKey = (team: string) => ["team", team, "domain-requests"];

export const domainStatusLabels: Record<DomainRequestStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  denied: "Denied",
  revoked: "Revoked",
};
const domainStatusTones: Record<DomainRequestStatus, Tone> = { pending: "info", approved: "success", denied: "danger", revoked: "warning" };

export function DomainStatusBadge({ status }: { status: DomainRequestStatus }) {
  return <StatusBadge tone={domainStatusTones[status]}>{domainStatusLabels[status]}</StatusBadge>;
}

const hostLabel = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const hostPattern = new RegExp(`^(\\*\\.)?(?:${hostLabel}\\.)+${hostLabel}$`, "i");

/**
 * Checks a host pattern: "example.org" (that host) or "*.example.org" (the
 * domain and its subdomains). `allowStar` also accepts "*" (every host),
 * which only platform admins may add to the allowlist.
 */
export function validateHostPattern(value: string, { allowStar = false } = {}): string | undefined {
  const v = value.trim();
  if (!v) return "Enter a host pattern.";
  if (v === "*") return allowStar ? undefined : "Request a specific domain, such as *.example.org.";
  if (/^[a-z]+:\/\//i.test(v) || v.includes("/")) return "Enter a host name only, without https:// or a path.";
  if (!hostPattern.test(v)) return "Use a host such as example.org, or *.example.org for the domain and every subdomain.";
  return undefined;
}

export function useDomainRequests(team: string) {
  return useQuery({
    queryKey: domainRequestsKey(team),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/domain-requests", { params: { path: { team } } })),
  });
}

/** The "Request a domain" dialog. `initialPattern` pre-fills the host, e.g. from a host_not_allowed error. */
export function RequestDomainDialog({
  team,
  initialPattern = "",
  open,
  onOpenChange,
}: {
  team: string;
  initialPattern?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const formId = useId();
  const [form, setForm] = useState({ pattern: initialPattern, reason: "" });
  const [submitted, setSubmitted] = useState(false);
  const patternError = validateHostPattern(form.pattern);
  const reasonError = form.reason.trim().length < 10 ? "Give a reason of at least 10 characters." : undefined;
  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/teams/{team}/domain-requests", {
          params: { path: { team } },
          body: { pattern: form.pattern.trim().toLowerCase(), reason: form.reason.trim() },
        }),
      ),
    onSuccess: (req) => {
      qc.invalidateQueries({ queryKey: domainRequestsKey(team) });
      toast.success("Domain requested", `A platform admin will review ${req.pattern}.`);
      onOpenChange(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setForm({ pattern: initialPattern, reason: "" });
          setSubmitted(false);
          create.reset();
        }
      }}
      title="Request a domain"
      description="Platform admins review requests to crawl sites outside the allowlist. Once approved, your team's web sources can crawl it."
      footer={
        <>
          <DialogClose>Cancel</DialogClose>
          <Button type="submit" form={formId} loading={create.isPending}>
            Send request
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
          if (!patternError && !reasonError) create.mutate();
        }}
      >
        <Field
          label="Host pattern"
          description="example.org allows only that host. *.example.org allows the domain and every subdomain."
          error={submitted ? patternError : undefined}
        >
          <Input
            aria-required
            autoComplete="off"
            spellCheck={false}
            placeholder="*.example.org"
            value={form.pattern}
            onChange={(e) => setForm({ ...form, pattern: e.target.value })}
          />
        </Field>
        <Field label="Reason" description="Why your team needs this site, at least 10 characters." error={submitted ? reasonError : undefined}>
          <Textarea aria-required maxLength={2000} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </Field>
        <ErrorAlert error={create.error} />
      </Form>
    </Dialog>
  );
}

/** The team's domain requests; `embedded` renders it as a Team settings tab. */
export function DomainRequestsPage({ embedded = false }: { embedded?: boolean }) {
  const { slug, canEdit, role } = useTeam();
  const requests = useDomainRequests(slug);
  const [requesting, setRequesting] = useState(false);
  useIntent("new-domain-request", () => canEdit && setRequesting(true));
  const list = requests.data ?? [];

  return (
    <Stack gap={6} className={embedded ? undefined : s.page}>
      <PageHeader
        title={embedded ? terms.crawlDomains : terms.domainRequests}
        titleAs={embedded ? "h2" : "h1"}
        description="Web sources can crawl hosts on the platform allowlist, such as *.example.edu. To crawl another site, request its domain. A platform admin reviews each request."
        actions={
          canEdit && (
            <Button onClick={() => setRequesting(true)}>
              <Plus aria-hidden /> Request a domain
            </Button>
          )
        }
      />
      {!embedded && <ArchivedNotice>Its domain requests are read-only.</ArchivedNotice>}
      {role === "member" && <Alert tone="info">Members can view domain requests. Editors, admins and owners can request domains.</Alert>}
      <DomainRequestList
        list={list}
        loading={requests.isLoading}
        error={requests.error}
        onRetry={() => void requests.refetch()}
        requestAction={canEdit ? () => setRequesting(true) : undefined}
      />
      {canEdit && <RequestDomainDialog team={slug} open={requesting} onOpenChange={setRequesting} />}
    </Stack>
  );
}
