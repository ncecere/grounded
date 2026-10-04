/*
 * Team settings › API keys (W6, D4, D5): the keys on a ListPage (type facet
 * and search in the URL), each key in a RecordPage (?record=<id>) with its
 * scopes, restrictions (knowledge bases, agents), owner or responsible
 * contact, expiry and last use, and Revoke. The secret is shown once, when
 * the key is created (create-dialog.tsx). The list shows active keys; a
 * revoked key (linked from the audit log) is loaded by its id (G12). Below,
 * the person's Connected apps (OAuth sign-in for MCP clients).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, KeyRound, Lock, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { api, unwrap } from "@/api/client";
import { ConfirmMutationDialog } from "@/components/confirm-dialog";
import { ListPage, timeColumn } from "@/components/templates/list-page";
import { useRecordParam } from "@/components/templates/record-page";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { toast } from "@/components/ui/toast/toast";
import { useIntent } from "@/lib/intents";
import { useCurrentUser } from "@/session";
import s from "../../shared.module.css";
import { useAgents } from "../../agents/common";
import { ConnectedApps } from "../../oauth/connected-apps";
import { keysKey, useKBs, useTeam } from "../common";
import { ArchivedNotice } from "../layout";
import { CreateKeyDialog } from "./create-dialog";
import { ExpiryBadge, KeyRecordPage, accessText, kindLabel, personName, useKeyById } from "./key-record";
import type { APIKey } from "./scopes";

const typeFacet: Facet<APIKey>[] = [
  {
    id: "type",
    label: "Type",
    type: "toggle",
    allLabel: "All",
    accessor: (k) => k.kind,
    options: [
      { value: "personal", label: "Personal" },
      { value: "service", label: "Service" },
    ],
  },
];

/** API keys; `embedded` renders it as a Team settings tab (an h2 header, no page padding). */
export function ApiKeysPage({ embedded = false }: { embedded?: boolean }) {
  const { slug, role, isManager, archived } = useTeam();
  const me = useCurrentUser();
  const qc = useQueryClient();
  const record = useRecordParam();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<APIKey | null>(null);
  useIntent("new-api-key", () => role && !archived && setCreating(true));
  const kbs = useKBs(slug);
  const agents = useAgents(slug);
  const keys = useQuery({
    queryKey: keysKey(slug),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/api-keys", { params: { path: { team: slug } } })),
    enabled: role !== undefined,
  });
  const revoke = useMutation({
    mutationFn: async (k: APIKey) => unwrap(await api.DELETE("/v1/teams/{team}/api-keys/{keyId}", { params: { path: { team: slug, keyId: k.id } } })),
    onSuccess: (_, k) => {
      setRevoking(null);
      if (record.id === k.id) record.close();
      toast.success(`${k.name} was revoked`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keysKey(slug) }),
  });
  const description =
    role &&
    (isManager
      ? "Keys let programs call the API as this team. You can see every key on the team. Widget keys for embedding an agent are on the agent's Share tab."
      : "Keys let your programs call the API for this team. You can see the personal keys you created.");
  const newKey = role && !archived && (
    <Button size={embedded ? "sm" : "md"} onClick={() => setCreating(true)}>
      <KeyRound aria-hidden /> New API key
    </Button>
  );
  // Embedded in Team settings, the tab is a titled card like Members, not a second page header (VI-12).
  const header = embedded ? undefined : <PageHeader title="API keys" description={description} actions={newKey} />;
  const frame = (content: ReactNode) =>
    embedded ? (
      <Card title="API keys" description={description} actions={newKey} flush>
        {content}
      </Card>
    ) : (
      <>
        {header}
        {content}
      </>
    );

  if (!role) {
    return (
      <Stack gap={6} className={embedded ? undefined : s.page}>
        {header}
        <Card title={embedded ? "API keys" : undefined}>
          <EmptyState icon={<Lock />} title="Only team members can see and create this team's API keys." />
        </Card>
      </Stack>
    );
  }

  const kbName = (id: string) => kbs.data?.find((k) => k.id === id)?.name ?? "Deleted knowledge base";
  const agentName = (id: string) => agents.data?.find((a) => a.id === id)?.name ?? "Deleted agent";
  // Archived teams keep revocation: a key can always be switched off.
  const canRevoke = (k: APIKey) => !k.revokedAt && (isManager || (k.kind === "personal" && k.userId === me.user.id));
  const list = keys.data ?? [];
  const listed = list.find((k) => k.id === record.id);
  // Not in the list (revoked, or not loaded yet): by its id.
  const byId = useKeyById(slug, keys.isSuccess && !listed ? record.id : undefined);
  const open = listed ?? byId.data;

  const columns: DataTableColumn<APIKey>[] = [
    {
      id: "name",
      header: "Name",
      accessor: "name",
      sortable: true,
      rowHeader: true,
      cell: (k) => <CellText primary={k.name} secondary={personName(k)} />,
    },
    {
      id: "type",
      header: "Type · scopes",
      accessor: (k) => `${kindLabel(k)} ${k.scopes.join(" ")}`,
      cell: (k) => `${kindLabel(k)} · ${k.scopes.join(", ")}`,
    },
    { id: "prefix", header: "Key", accessor: "prefix", cell: (k) => <code className={s.mono}>{k.prefix}</code> },
    { id: "access", header: "Access", accessor: (k) => accessText(k, kbName, agentName), muted: true },
    timeColumn("lastUsedAt", "Last used", (k) => k.lastUsedAt),
    {
      id: "expiresAt",
      header: "Expires",
      accessor: (k) => (k.expiresAt ? new Date(k.expiresAt) : null),
      sortable: true,
      cell: (k) => <ExpiryBadge k={k} />,
    },
  ];

  return (
    <Stack gap={6} className={embedded ? undefined : s.page}>
      {!embedded && <ArchivedNotice>New keys can't be created, but existing keys can be revoked.</ArchivedNotice>}
      {frame(
        <ListPage<APIKey>
          id="team-api-keys"
          caption="API keys"
          columns={columns}
          data={list}
          getRowId={(k) => k.id}
          rowLabel={(k) => k.name}
          facets={typeFacet}
          search={{ label: "Search API keys", placeholder: "Name or key" }}
          onRowClick={(k) => record.open(k.id)}
          rowActions={(k) => [
            { label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(k.id) },
            { label: "Revoke…", icon: <Trash2 aria-hidden />, danger: true, hidden: !canRevoke(k), onSelect: () => setRevoking(k) },
          ]}
          loading={keys.isLoading}
          error={keys.error}
          onRetry={() => void keys.refetch()}
          empty={{
            icon: <KeyRound />,
            title: "No API keys yet.",
            // The header's New API key is the one way to create one (no second button here).
            description: "A key lets your programs call the API, or an AI tool connect over MCP.",
          }}
        />,
      )}
      {/* The person's own OAuth apps (not the team's): shown while OAuth sign-in is on, or while any is connected. */}
      <ConnectedApps owner={{ self: true }} canDisconnect hideWhenEmpty={!me.capabilities.mcpOAuth} />
      <KeyRecordPage
        k={open}
        loading={!open && (keys.isLoading || byId.isLoading)}
        open={Boolean(record.id)}
        onClose={record.close}
        kbName={kbName}
        agentName={agentName}
        onRevoke={open && canRevoke(open) ? () => setRevoking(open) : undefined}
      />
      {creating && <CreateKeyDialog kbs={kbs.data ?? []} onClose={() => setCreating(false)} />}
      <ConfirmMutationDialog
        target={revoking}
        onClose={() => setRevoking(null)}
        mutation={revoke}
        onConfirm={(k) => revoke.mutate(k)}
        title={`Revoke ${revoking?.name ?? "key"}?`}
        description="Programs using this key will stop working immediately. This can't be undone."
        confirmLabel="Revoke key"
      />
    </Stack>
  );
}
