/*
 * "Share…" on a conversation (v0.6.0, C12; ADR-0010): make a link to a read-only snapshot of your own conversation, see the links you made, and revoke
 * them. The link is shown once (only its hash is kept). The dialog says, before the link exists, who can read it and that it can't be taken back
 * from someone who already has: a link is a bearer secret.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError, api, unwrap, type Schemas } from "../../api/client";
import { agentProfileQuery } from "../../api/queries";
import { ApiErrorAlert } from "../../components/errors";
import { Alert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button, IconButton } from "@/components/ui/button/button";
import { Checkbox } from "@/components/ui/checkbox/checkbox";
import { CopyField } from "@/components/ui/copy-field/copy-field";
import { AlertDialog, Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { Skeleton } from "@/components/ui/skeleton/skeleton";
import { toast } from "@/components/ui/toast/toast";
import { RelativeTime } from "../../components/templates/list-page";
import type { ConversationSummary } from "./conversations";

type Audience = Schemas["ShareAudience"];
type Share = Schemas["ConversationShare"];

const sharesKey = (id: string) => ["conversation-shares", id];

/** Who an agent's own audience lets read a link made for "the agent's users". */
function usersText(audience: Schemas["Audience"] | undefined, teamName: string) {
  if (audience === "public" || audience === "all_authenticated") return "Anyone who is signed in";
  return `Members of ${teamName || "the agent's team"}`;
}

export function ShareDialog({ conversation, onClose }: { conversation: ConversationSummary; onClose: () => void }) {
  const qc = useQueryClient();
  const card = useQuery({ ...agentProfileQuery({ team: conversation.teamSlug, agent: conversation.agentSlug }), enabled: !conversation.agentDeleted, retry: false });
  const shares = useQuery({
    queryKey: sharesKey(conversation.id),
    queryFn: async () => unwrap(await api.GET("/v1/conversations/{conversationId}/shares", { params: { path: { conversationId: conversation.id } } })),
  });
  const [audience, setAudience] = useState<Audience>("agent_users");
  const [showName, setShowName] = useState(false);
  const [made, setMade] = useState<Schemas["ConversationShareCreated"] | null>(null);
  const [revoking, setRevoking] = useState<Share | null>(null);
  const isPublic = card.data?.audience === "public";
  const create = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/v1/conversations/{conversationId}/shares", { params: { path: { conversationId: conversation.id } }, body: { audience, showName } })),
    onSuccess: (r) => {
      setMade(r);
      void qc.invalidateQueries({ queryKey: sharesKey(conversation.id) });
    },
  });
  const revoke = useMutation({
    mutationFn: async (s: Share) =>
      unwrap(await api.DELETE("/v1/conversations/{conversationId}/shares/{shareId}", { params: { path: { conversationId: conversation.id, shareId: s.id } } })),
    onSuccess: () => {
      setRevoking(null);
      toast.success("The link was revoked", "It no longer opens.");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: sharesKey(conversation.id) }),
  });
  const code = create.error instanceof ApiError ? create.error.code : "";
  const title = conversation.title || "Untitled conversation";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg" title="Share this conversation" description={<>“<bdi>{title}</bdi>” with <bdi>{conversation.agentName}</bdi></>} footer={<DialogClose>Done</DialogClose>}>
      {conversation.agentDeleted ? (
        <Alert tone="info" title="This agent was deleted">
          A conversation with a deleted agent can't be shared.
        </Alert>
      ) : (
        <>
          {/* The new link first: the dialog is taller than a short window, and the link is shown only once. */}
          {made && <CopyField label="Your link" name="link" value={made.url} description="Copy it now: it is shown only once. To get a link again, make a new one." />}
          <Alert tone="warning" title="Anyone who opens the link can read this conversation">
            They see your questions, the answers and their sources, up to the last answer now. They never see your feedback, the model's reasoning or what the agent did to answer. You can't take
            back what someone has already read, so share it only with people you trust with what it says.
          </Alert>
          <RadioGroup<Audience>
            legend="Who can open the link"
            variant="card"
            value={audience}
            onValueChange={(v) => {
              setAudience(v);
              create.reset();
            }}
            options={[
              { value: "agent_users", label: `People who can use ${conversation.agentName}`, description: `${usersText(card.data?.audience, card.data?.teamName ?? "")} can open it, after they sign in.` },
              ...(isPublic ? [{ value: "anyone" as const, label: "Anyone with the link", description: "No sign-in needed. This agent is public, so the link works for anyone who has it." }] : []),
            ]}
          />
          <Checkbox label="Show my name" description="Your display name appears on the shared view. Off by default." checked={showName} onCheckedChange={(v) => setShowName(Boolean(v))} />
          {code === "public_share_unavailable" ? (
            <Alert tone="danger" title="A link open to anyone isn't available">
              It needs a public agent with public access turned on. Choose the other option.
            </Alert>
          ) : (
            <ApiErrorAlert error={create.error} />
          )}
          <div>
            <Button onClick={() => create.mutate()} loading={create.isPending}>
              <Link2 aria-hidden /> Create link
            </Button>
          </div>
        </>
      )}
      <h3>Links you made</h3>
      {shares.isLoading ? (
        <Skeleton height="2.5rem" />
      ) : (shares.data ?? []).length === 0 ? (
        <p>You haven't made a link to this conversation.</p>
      ) : (
        <ul aria-label="Links to this conversation">
          {(shares.data ?? []).map((s) => (
            <li key={s.id}>
              <span>
                Made <RelativeTime value={s.createdAt} /> · {s.messageCount} messages ·{" "}
                <Badge tone={s.audience === "anyone" ? "warning" : "neutral"} size="sm">
                  {s.audience === "anyone" ? "Anyone with the link" : "People who can use the agent"}
                </Badge>
                {s.showName ? " · your name shown" : ""}
              </span>{" "}
              <IconButton size="sm" icon={<Trash2 aria-hidden />} label={`Revoke the link made ${new Date(s.createdAt).toLocaleString()}`} onClick={() => setRevoking(s)} />
            </li>
          ))}
        </ul>
      )}
      <AlertDialog
        open={revoking !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRevoking(null);
            revoke.reset();
          }
        }}
        title="Revoke this link?"
        description="It stops opening at once, for everyone who has it. People who already read the conversation have read it."
        confirmLabel="Revoke link"
        busy={revoke.isPending}
        error={revoke.error}
        onConfirm={() => revoking && revoke.mutate(revoking)}
      />
    </Dialog>
  );
}
