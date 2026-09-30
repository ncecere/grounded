/*
 * Connected apps (docs/mcp.md, "Signing in with OAuth"): the AI tools a
 * person allowed to search and ask as them with OAuth sign-in (an OAuth
 * grant each), with when they were connected and last used, and Disconnect.
 * The person sees theirs on their team's API keys page; platform admins see
 * anyone's on the person's admin page (auditors read, without Disconnect).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug, Unplug } from "lucide-react";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { ConfirmMutationDialog } from "@/components/confirm-dialog";
import { RelativeTime } from "@/components/templates/list-page";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Loading } from "@/components/ui/spinner/spinner";
import { Table, TableActions, Td, Th, Tr } from "@/components/ui/table/table";
import { toast } from "@/components/ui/toast/toast";
import s from "../shared.module.css";

type Grant = Schemas["OAuthGrant"];

/** Whose apps: the signed-in person's, or (admin pages) another person's. */
export type ConnectedAppsOwner = { self: true } | { self: false; userId: string; name: string };

const grantsKey = (owner: ConnectedAppsOwner) => (owner.self ? ["me", "oauth-grants"] : ["admin", "users", owner.userId, "oauth-grants"]);

function useGrants(owner: ConnectedAppsOwner) {
  return useQuery({
    queryKey: grantsKey(owner),
    queryFn: async () =>
      owner.self
        ? unwrap(await api.GET("/v1/me/oauth-grants"))
        : unwrap(await api.GET("/v1/admin/users/{userId}/oauth-grants", { params: { path: { userId: owner.userId } } })),
  });
}

function useDisconnect(owner: ConnectedAppsOwner, onDone: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (g: Grant) =>
      owner.self
        ? unwrap(await api.DELETE("/v1/me/oauth-grants/{grantId}", { params: { path: { grantId: g.id } } }))
        : unwrap(await api.DELETE("/v1/admin/users/{userId}/oauth-grants/{grantId}", { params: { path: { userId: owner.userId, grantId: g.id } } })),
    onSuccess: (_, g) => {
      onDone();
      toast.success(`${g.clientName} was disconnected`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: grantsKey(owner) }),
  });
}

/**
 * The Connected apps card. `hideWhenEmpty` leaves it out for a person with
 * no apps while OAuth sign-in is off (the API keys page).
 */
export function ConnectedApps({ owner, canDisconnect, hideWhenEmpty = false }: { owner: ConnectedAppsOwner; canDisconnect: boolean; hideWhenEmpty?: boolean }) {
  const grants = useGrants(owner);
  const [target, setTarget] = useState<Grant | null>(null);
  const disconnect = useDisconnect(owner, () => setTarget(null));
  const list = grants.data ?? [];
  if (hideWhenEmpty && grants.isSuccess && list.length === 0) return null;
  const whose = owner.self ? "you" : owner.name;
  return (
    <Card
      title="Connected apps"
      description={`AI tools ${owner.self ? "you" : owner.name} allowed to search knowledge bases and ask agents as ${owner.self ? "you" : "them"}, with OAuth sign-in. Disconnecting one stops it at once.`}
      flush={list.length > 0}
    >
      {grants.isLoading && <Loading label="Loading connected apps…" />}
      <ErrorAlert error={grants.error} title="Couldn't load connected apps" />
      {grants.isSuccess && list.length === 0 && (
        <EmptyState size="compact" icon={<Plug />} title="No connected apps." description={`Apps ${whose} connect with OAuth sign-in are listed here.`} />
      )}
      {list.length > 0 && (
        <Table caption="Connected apps" columns={["App", "Connected", "Last used", ""]}>
          {list.map((g) => (
            <Tr key={g.id}>
              <Th>
                <span className={s.primary}>{g.clientName}</span>{" "}
                {g.clientKind === "registered" && (
                  <Badge size="sm" tone="neutral">
                    Unverified
                  </Badge>
                )}
                {g.clientHost && <span className={s.secondary}>{g.clientHost}</span>}
              </Th>
              <Td>
                <RelativeTime value={g.createdAt} />
              </Td>
              <Td>{g.lastUsedAt ? <RelativeTime value={g.lastUsedAt} /> : "Never"}</Td>
              <Td>
                {canDisconnect && (
                  <TableActions>
                    <Button size="sm" variant="secondary" onClick={() => setTarget(g)} aria-label={`Disconnect ${g.clientName}…`}>
                      <Unplug aria-hidden /> Disconnect…
                    </Button>
                  </TableActions>
                )}
              </Td>
            </Tr>
          ))}
        </Table>
      )}
      <ConfirmMutationDialog
        target={target}
        onClose={() => setTarget(null)}
        mutation={disconnect}
        onConfirm={(g) => disconnect.mutate(g)}
        title={`Disconnect ${target?.clientName ?? "this app"}?`}
        description="It stops working at once and has to ask again before it can connect. Its conversations are kept."
        confirmLabel="Disconnect"
      />
    </Card>
  );
}
