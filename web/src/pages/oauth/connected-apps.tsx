/*
 * Connected apps (docs/mcp.md, "Signing in with OAuth"): the AI tools a
 * person allowed to search and ask as them with OAuth sign-in (an OAuth
 * grant each), with when they were connected and last used, and Disconnect.
 * Everyone reaches theirs from the account menu (/settings/connected-apps,
 * also for people in no team) and from their team's API keys page; platform
 * admins see anyone's on the person's admin page (auditors read, without
 * Disconnect), with absolute dates as on any record page.
 *
 * A list rather than a table, so Disconnect wraps under the app on a phone
 * instead of scrolling out of view.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug, Unplug } from "lucide-react";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { ConfirmMutationDialog } from "@/components/confirm-dialog";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item/item";
import { Loading } from "@/components/ui/spinner/spinner";
import { Time } from "@/components/ui/time/time";
import { toast } from "@/components/ui/toast/toast";
import s from "../shared.module.css";
import styles from "./connected-apps.module.css";

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

function intro(owner: ConnectedAppsOwner, canDisconnect: boolean) {
  const who = owner.self ? "you" : owner.name;
  const them = owner.self ? "you" : "them";
  const lead = `AI tools ${who} allowed to search knowledge bases and ask agents as ${them}, with OAuth sign-in.`;
  return canDisconnect ? `${lead} Disconnecting one stops it at once.` : lead;
}

/**
 * The Connected apps card. `hideWhenEmpty` leaves it out for a person with
 * no apps while OAuth sign-in is off (the API keys page). `title` names the
 * card where the page itself is already called Connected apps.
 */
export function ConnectedApps({
  owner,
  canDisconnect,
  hideWhenEmpty = false,
  title = "Connected apps",
}: {
  owner: ConnectedAppsOwner;
  canDisconnect: boolean;
  hideWhenEmpty?: boolean;
  title?: string;
}) {
  const grants = useGrants(owner);
  const [target, setTarget] = useState<Grant | null>(null);
  const disconnect = useDisconnect(owner, () => setTarget(null));
  const list = grants.data ?? [];
  if (hideWhenEmpty && grants.isSuccess && list.length === 0) return null;
  const empty = owner.self ? "Apps you connect with OAuth sign-in are listed here." : `Apps ${owner.name} connects with OAuth sign-in are listed here.`;
  // A person's admin page is a record page: absolute dates there.
  const format = owner.self ? "relative" : "datetime";
  return (
    <Card title={title} description={intro(owner, canDisconnect)}>
      {grants.isLoading && <Loading label="Loading connected apps…" />}
      <ErrorAlert error={grants.error} title="Couldn't load connected apps" />
      {grants.isSuccess && list.length === 0 && <EmptyState size="compact" icon={<Plug />} title="No connected apps." description={empty} />}
      {list.length > 0 && (
        <ItemGroup aria-label={owner.self ? "Your connected apps" : `Apps ${owner.name} connected`}>
          {list.map((g) => (
            <Item key={g.id} size="sm" variant="outline">
              <ItemContent>
                <ItemTitle>
                  {g.clientName}{" "}
                  {g.clientKind === "registered" && (
                    <Badge size="sm" tone="neutral">
                      Unverified
                    </Badge>
                  )}
                </ItemTitle>
                {g.clientHost && <ItemDescription className={s.mono}>{g.clientHost}</ItemDescription>}
                <ItemDescription className={styles.appMeta}>
                  <span>
                    Connected <Time value={g.createdAt} format={format} />
                  </span>
                  <span>{g.lastUsedAt ? <>Last used <Time value={g.lastUsedAt} format={format} /></> : "Not used yet"}</span>
                </ItemDescription>
              </ItemContent>
              {canDisconnect && (
                <ItemActions>
                  <Button size="sm" variant="secondary" onClick={() => setTarget(g)} aria-label={`Disconnect ${g.clientName}…`}>
                    <Unplug aria-hidden /> Disconnect…
                  </Button>
                </ItemActions>
              )}
            </Item>
          ))}
        </ItemGroup>
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
