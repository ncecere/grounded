/*
 * One API key in a RecordPage (D4): what it may do (scopes), what it may
 * reach (knowledge bases and agents, F-25), who owns it or answers for it
 * (a service key's responsible contact, reassignable by admins and owners),
 * expiry and last use. The secret is never shown again.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { membersKey } from "@/components/members";
import { RecordPage } from "@/components/templates/record-page";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Field } from "@/components/ui/field/field";
import { NativeSelect } from "@/components/ui/input/input";
import { Time } from "@/components/ui/time/time";
import { toast } from "@/components/ui/toast/toast";
import s from "../../shared.module.css";
import ks from "./keys.module.css";
import { keysKey, useTeam } from "../common";
import { type APIKey, scopeLabels } from "./scopes";

const DAY = 86_400_000;

export const kindLabel = (k: APIKey) => (k.kind === "service" ? "Service" : "Personal");

/** One key by id, including a revoked one (the list shows active keys only); `id` undefined: off. */
export function useKeyById(team: string, id: string | undefined) {
  return useQuery({
    queryKey: [...keysKey(team), id],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/api-keys/{keyId}", { params: { path: { team, keyId: id! } } })),
    enabled: Boolean(id),
    retry: false,
  });
}

/** The owner (personal) or responsible contact (service), for the list. */
export function personName(k: APIKey) {
  if (!k.contact) return k.kind === "service" ? "No contact" : undefined;
  const who = k.contact.name || k.contact.email;
  return k.kind === "service" ? `Contact: ${who}` : who;
}

/** What a key may use: "All", or its knowledge bases and agents. */
export function accessText(k: APIKey, kbName: (id: string) => string, agentName: (id: string) => string) {
  const parts = [
    k.knowledgeBaseIds?.length ? `KBs: ${k.knowledgeBaseIds.map(kbName).join(", ")}` : "",
    k.agentIds?.length ? `Agents: ${k.agentIds.map(agentName).join(", ")}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "All";
}

/** The expiry date, flagged when it has passed or is within two weeks. */
export function ExpiryBadge({ k, now = Date.now() }: { k: APIKey; now?: number }) {
  if (!k.expiresAt) return <span className={s.muted}>Never</span>;
  const left = new Date(k.expiresAt).getTime() - now;
  return (
    <span className={s.badges}>
      <Time value={k.expiresAt} format="date" />
      {left <= 0 ? (
        <Badge tone="danger" size="sm">
          Expired
        </Badge>
      ) : left <= 14 * DAY ? (
        <Badge tone="warning" size="sm">
          Expires soon
        </Badge>
      ) : null}
    </span>
  );
}

type Props = {
  k?: APIKey;
  open: boolean;
  loading: boolean;
  onClose: () => void;
  kbName: (id: string) => string;
  agentName: (id: string) => string;
  onRevoke?: () => void;
};

export function KeyRecordPage({ k, open, loading, onClose, kbName, agentName, onRevoke }: Props) {
  const list = (ids: string[] | null | undefined, name: (id: string) => string, all: string) =>
    ids?.length ? (
      <ul className={ks.list}>
        {ids.map((id) => (
          <li key={id}>{name(id)}</li>
        ))}
      </ul>
    ) : (
      all
    );
  return (
    <RecordPage
      open={open}
      onClose={onClose}
      title={k?.name ?? "API key"}
      description={k?.revokedAt ? "A revoked API key of this team. It no longer works." : "An API key of this team. Its secret was shown once, when it was created."}
      loading={loading}
      error={!loading && open && !k ? new Error("This key doesn't exist, or you can't see it.") : undefined}
      facts={
        k
          ? [
              ...(k.revokedAt ? [{ label: "Revoked", value: <Time value={k.revokedAt} format="datetime" /> }] : []),
              { label: "Type", value: k.kind === "service" ? "Team service key" : "Personal key" },
              { label: "Key", value: <code className={s.mono}>{k.prefix}</code> },
              { label: k.kind === "service" ? "Responsible contact" : "Owner", value: personName(k)?.replace(/^Contact: /, "") ?? "Unknown" },
              { label: "Knowledge bases", value: list(k.knowledgeBaseIds, kbName, "Every knowledge base of the team") },
              { label: "Agents", value: list(k.agentIds, agentName, "Every agent of the team") },
              { label: "Expires", value: <ExpiryBadge k={k} /> },
              { label: "Last used", value: k.lastUsedAt ? <Time value={k.lastUsedAt} format="datetime" /> : "Never" },
              { label: "Created", value: <Time value={k.createdAt} format="datetime" /> },
            ]
          : []
      }
      sections={
        k
          ? [
              {
                title: "Scopes",
                content: (
                  <ul className={ks.list}>
                    {k.scopes.map((sc) => (
                      <li key={sc}>{scopeLabels[sc]}</li>
                    ))}
                  </ul>
                ),
              },
              ...(k.kind === "service" && !k.revokedAt ? [{ title: "Responsible contact", content: <ContactField k={k} /> }] : []),
            ]
          : []
      }
      actions={
        k &&
        onRevoke && (
          <Button variant="danger" onClick={onRevoke}>
            <Trash2 aria-hidden /> Revoke key
          </Button>
        )
      }
    />
  );
}

/** Admins and owners reassign a service key's contact; others read it. */
function ContactField({ k }: { k: APIKey }) {
  const { slug, isManager, archived } = useTeam();
  const qc = useQueryClient();
  const [value, setValue] = useState(k.contact?.userId ?? "");
  const members = useQuery({
    queryKey: membersKey(slug),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/members", { params: { path: { team: slug } } })),
    enabled: isManager && !archived,
  });
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PATCH("/v1/teams/{team}/api-keys/{keyId}", {
          params: { path: { team: slug, keyId: k.id } },
          body: { responsibleUserId: value },
        }),
      ),
    onSuccess: () => {
      toast.success("Contact changed");
      void qc.invalidateQueries({ queryKey: keysKey(slug) });
    },
  });
  if (!isManager || archived) {
    return <p className={s.settingDescription}>The person to ask about this key. Team admins and owners can change it.</p>;
  }
  return (
    <form
      className={ks.contact}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Contact" description="The team member to ask about this key.">
        <NativeSelect value={value} onChange={(e) => setValue(e.target.value)}>
          {!k.contact && <option value="">No contact</option>}
          {(members.data ?? []).map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.displayName || m.user.email}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Button type="submit" variant="secondary" size="sm" loading={save.isPending} disabled={!value || value === k.contact?.userId}>
        Change contact
      </Button>
      <ErrorAlert error={save.error} />
    </form>
  );
}
