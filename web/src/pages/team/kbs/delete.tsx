/*
 * Deleting a knowledge base, from the header's "…" menu or the Settings
 * Danger zone: one confirmation, and when published agents use it
 * (kb_in_use) the dialog names them with links.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ApiError, api, unwrap } from "@/api/client";
import { Alert } from "@/components/ui/alert/alert";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import s from "../../shared.module.css";
import { type KB, kbKey, kbsKey, useTeam } from "../common";

export function useDeleteKB(kb: KB) {
  const { slug } = useTeam();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: async () => unwrap(await api.DELETE("/v1/teams/{team}/kbs/{kbId}", { params: { path: { team: slug, kbId: kb.id } } })),
    onSuccess: () => {
      qc.removeQueries({ queryKey: kbKey(slug, kb.id) });
      qc.invalidateQueries({ queryKey: kbsKey(slug) });
      toast.success(`${kb.name} was deleted`);
      void navigate({ to: "/teams/$team/kbs", params: { team: slug } });
    },
  });
  const inUse =
    remove.error instanceof ApiError && remove.error.code === "kb_in_use"
      ? ((remove.error.details?.agents as { id: string; name: string; slug: string }[] | undefined) ?? [])
      : undefined;

  const dialog = (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) remove.reset();
      }}
      title={`Delete ${kb.name}?`}
      description="Agents and API keys that use this knowledge base will stop finding its content. Its data sources are kept."
      confirmLabel="Delete knowledge base"
      busy={remove.isPending}
      error={inUse ? undefined : remove.error}
      onConfirm={() => remove.mutate()}
    >
      {inUse && (
        <Alert tone="danger" title="Published agents use this knowledge base">
          Remove it from {inUse.length === 1 ? "this agent" : "these agents"} and publish again first:
          <ul className={s.inUseList}>
            {inUse.map((ag) => (
              <li key={ag.id}>
                <TextLink render={<Link to="/teams/$team/agents/$agentId" params={{ team: slug, agentId: ag.id }} />}>{ag.name}</TextLink>
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </AlertDialog>
  );
  return { request: () => setOpen(true), dialog };
}
