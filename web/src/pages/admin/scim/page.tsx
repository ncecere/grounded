/*
 * Admin → SCIM provisioning (docs/operations/scim.md; route /admin/scim), in pill tabs (?tab=): Setup (what to give the
 * identity provider: the base URL and the matching claim, and how many people and groups SCIM manages) and Tokens (the
 * active tokens, with Create and Revoke). A token's secret is
 * shown once, in a dialog, after it is made. Platform admins manage tokens; auditors read the page.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { KeyRound, Plug, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { ConfirmMutationDialog } from "@/components/confirm-dialog";
import { PageTabs, useUrlTab } from "@/components/page-tabs";
import { QueryView } from "@/components/query-view";
import { ListPage, RelativeTime } from "@/components/templates/list-page";
import { Alert } from "@/components/ui/alert/alert";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { CopyField } from "@/components/ui/copy-field/copy-field";
import { type DataTableColumn } from "@/components/ui/data-table/data-table";
import { DescriptionList } from "@/components/ui/description-list/description-list";
import { Dialog } from "@/components/ui/dialog/dialog";
import { Field } from "@/components/ui/field/field";
import { Input } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import { scimTabs } from "@/lib/tabs";
import s from "../../shared.module.css";
import { useIsPlatformAdmin } from "../hooks";

type Token = Schemas["ScimToken"];
type Status = Schemas["ScimStatus"];

export const scimKey = ["admin", "scim"];

export function ScimPage() {
  const isAdmin = useIsPlatformAdmin();
  const status = useQuery({ queryKey: scimKey, queryFn: async () => unwrap(await api.GET("/v1/admin/scim")) });
  const [tab, setTab] = useUrlTab(scimTabs);
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="SCIM provisioning"
        description="Your identity provider can create people before they first sign in, keep their names and email addresses current, and suspend people who leave. Its groups feed the SSO group mapping rules."
      />
      <QueryView query={status} loadingLabel="Loading SCIM provisioning…">
        {status.data && (
          <PageTabs
            label="SCIM provisioning sections"
            value={tab}
            onValueChange={setTab}
            tabs={[
              { value: "setup", label: "Setup", icon: <Plug aria-hidden />, content: <Connection status={status.data} /> },
              { value: "tokens", label: `Tokens (${status.data.tokens.length})`, icon: <KeyRound aria-hidden />, content: <Tokens status={status.data} isAdmin={isAdmin} /> },
            ]}
          />
        )}
      </QueryView>
    </Stack>
  );
}

function Connection({ status }: { status: Status }) {
  return (
    <Card
      title="Connect your identity provider"
      description="Give your identity provider the base URL and a token from below. It finds people by their object ID (externalId), never by email address."
      actions={<StatusBadge tone={status.available ? "success" : "neutral"}>{status.available ? "Available" : "Unavailable"}</StatusBadge>}
    >
      <Stack gap={4}>
        {!status.available && (
          <Alert tone="info" title="SCIM needs a sign-in provider">
            Set OIDC_ISSUER and the other sign-in settings first: a person SCIM creates is linked to their account when they first sign in.
          </Alert>
        )}
        <CopyField label="Base URL" name="SCIM base URL" value={status.baseUrl} />
        <DescriptionList
          items={[
            {
              label: "Matching claim",
              value: (
                <>
                  <code>{status.matchClaim}</code>: a person&apos;s first sign-in is linked to the account SCIM made when this claim equals its externalId. Okta: keep{" "}
                  <code>sub</code>. Entra ID: set <code>SCIM_MATCH_CLAIM=oid</code> and map externalId to objectId.
                </>
              ),
            },
            {
              label: "People",
              value: `${status.users.toLocaleString()} managed by SCIM${status.pendingUsers > 0 ? `, ${status.pendingUsers.toLocaleString()} not signed in yet` : ""}`,
            },
            {
              label: "Groups",
              value: (
                <>
                  {status.groups.toLocaleString()}. They work like a sign-in&apos;s groups in{" "}
                  <TextLink render={<Link to="/admin/group-mapping" />}>SSO groups</TextLink>, by name or by object ID.
                </>
              ),
            },
          ]}
        />
      </Stack>
    </Card>
  );
}

const columns: DataTableColumn<Token>[] = [
  { id: "name", header: "Name", accessor: (t) => t.name, rowHeader: true },
  { id: "createdBy", header: "Created by", accessor: (t) => t.createdBy || "—", muted: true },
  { id: "createdAt", header: "Created", accessor: (t) => new Date(t.createdAt), cell: (t) => <RelativeTime value={t.createdAt} /> },
  {
    id: "lastUsedAt",
    header: "Last used",
    accessor: (t) => (t.lastUsedAt ? new Date(t.lastUsedAt) : new Date(0)),
    cell: (t) => (t.lastUsedAt ? <RelativeTime value={t.lastUsedAt} /> : <span className={s.muted}>Never</span>),
  },
];

function Tokens({ status, isAdmin }: { status: Status; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<Schemas["ScimTokenCreated"] | null>(null);
  const [revoking, setRevoking] = useState<Token | null>(null);
  const revoke = useMutation({
    mutationFn: async (t: Token) => unwrap(await api.DELETE("/v1/admin/scim/tokens/{tokenId}", { params: { path: { tokenId: t.id } } })),
    onSuccess: (_, t) => {
      toast.success(`${t.name} was revoked`);
      setRevoking(null);
      void qc.invalidateQueries({ queryKey: scimKey });
    },
  });
  const full = status.tokens.length >= 10;
  return (
    <Card
      title="Tokens"
      description="A token reaches SCIM and nothing else. At most 10 can be active; make a new one before revoking the old one to rotate it."
      actions={
        isAdmin && (
          <Button size="sm" variant="secondary" disabled={!status.available || full} onClick={() => setCreating(true)}>
            <Plus aria-hidden /> Create token
          </Button>
        )
      }
      flush
    >
      <ListPage<Token>
        id="admin-scim-tokens"
        caption="SCIM tokens"
        columns={columns}
        data={status.tokens}
        getRowId={(t) => t.id}
        rowLabel={(t) => t.name}
        rowActions={isAdmin ? (t) => [{ label: "Revoke…", icon: <Trash2 aria-hidden />, danger: true, onSelect: () => setRevoking(t) }] : undefined}
        empty={{ icon: <KeyRound />, title: "No tokens yet.", description: status.available ? "Create one for your identity provider." : undefined }}
      />
      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            setCreated(c);
            void qc.invalidateQueries({ queryKey: scimKey });
          }}
        />
      )}
      {created && <SecretDialog created={created} baseUrl={status.baseUrl} onClose={() => setCreated(null)} />}
      <ConfirmMutationDialog
        target={revoking}
        onClose={() => setRevoking(null)}
        mutation={revoke}
        onConfirm={(t) => revoke.mutate(t)}
        title={`Revoke ${revoking?.name ?? "this token"}?`}
        description="It stops working at once: the identity provider can't create, update or suspend anyone with it. People and groups it provisioned stay as they are."
        confirmLabel="Revoke"
      />
    </Card>
  );
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Schemas["ScimTokenCreated"]) => void }) {
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: async () => unwrap(await api.POST("/v1/admin/scim/tokens", { body: { name: name.trim() } })),
    onSuccess: onCreated,
  });
  const blank = name.trim() === "";
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Create a SCIM token"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} disabled={blank} onClick={() => create.mutate()}>
            Create token
          </Button>
        </>
      }
    >
      <Stack gap={4}>
        <Field label="Name" description="For example the identity provider's name, so you know which token to revoke." error={create.error instanceof Error ? create.error.message : undefined}>
          <Input value={name} maxLength={100} autoFocus onChange={(e) => (create.reset(), setName(e.target.value))} />
        </Field>
      </Stack>
    </Dialog>
  );
}

function SecretDialog({ created, baseUrl, onClose }: { created: Schemas["ScimTokenCreated"]; baseUrl: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="SCIM token created" description={created.token.name} size="lg" footer={<Button onClick={onClose}>Done</Button>}>
      <Stack gap={5}>
        <Alert tone="warning" title="Copy this token now.">
          It won&apos;t be shown again. Paste it into your identity provider&apos;s provisioning settings as the secret token (bearer token). If you lose it, create another and revoke this one.
        </Alert>
        <CopyField label="Base URL" name="SCIM base URL" value={baseUrl} />
        <CopyField label="Token" name="SCIM token" value={created.secret} />
      </Stack>
    </Dialog>
  );
}
