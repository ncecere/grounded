/*
 * A source's lifecycle actions: Pause / Resume and Delete. The header's "…"
 * menu and the Settings Danger zone use the same hook, so there is one
 * confirmation dialog and one set of messages (D3, F-21: "Resume", not
 * "Activate").
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Pause, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ActionItem } from "@/components/templates/action-menu";
import { AlertDialog, Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import { type KB, plural } from "../team/common";
import { useInvalidateSource } from "./invalidate";
import { useSourceUsedBy } from "./overview";
import { type DataSource, useSourceOwner } from "./owner";
import w from "./detail.module.css";

export type SourceActions = ReturnType<typeof useSourceActions>;

/** What pausing means for this kind of source (Danger zone and the paused notice). */
export const pauseHelp = (web: boolean) =>
  web
    ? "A paused source doesn't crawl, even on its schedule, and pausing cancels a running crawl. Search over indexed pages keeps working."
    : "A paused source accepts no uploads and its pending documents wait. Search over indexed documents keeps working.";

export function useSourceActions(source: DataSource) {
  const owner = useSourceOwner();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const invalidate = useInvalidateSource(source);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const paused = source.status === "paused";

  const status = useMutation({
    mutationFn: (next: "active" | "paused") => owner.api.update(source, { status: next }),
    onSuccess: (updated) => {
      qc.setQueryData(owner.keys.source(source.id), updated);
      if (updated.status === "paused") toast.success("Source paused", source.type === "web" ? "It won't crawl until you resume it." : "It won't accept uploads until you resume it.");
      else toast.success("Source resumed");
    },
    onError: (err) => toast.error(paused ? "Couldn't resume the source" : "Couldn't pause the source", err instanceof Error ? err.message : undefined),
    onSettled: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => owner.api.remove(source.id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: owner.keys.source(source.id) });
      qc.invalidateQueries({ queryKey: owner.keys.list });
      toast.success(`${source.name} was deleted`);
      owner.go(navigate);
    },
  });

  const toggle = () => status.mutate(paused ? "active" : "paused");
  const menuActions: ActionItem[] = owner.canEdit
    ? [
        { label: "Pause source", icon: <Pause aria-hidden />, onSelect: toggle, hidden: paused },
        { label: "Delete source…", icon: <Trash2 aria-hidden />, danger: true, onSelect: () => setConfirmDelete(true) },
      ]
    : [];

  // A team source that knowledge bases search can't be deleted: say so before any destructive button (BU-17).
  const usedBy = useSourceUsedBy(source);
  const blocked = owner.team && usedBy && usedBy.length > 0 ? usedBy : undefined;
  const dialog = blocked ? (
    <InUseDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} source={source} kbs={blocked} team={owner.team!} />
  ) : (
    <AlertDialog
      open={confirmDelete}
      onOpenChange={(o) => {
        setConfirmDelete(o);
        if (!o) remove.reset();
      }}
      title={`Delete ${source.name}?`}
      description={`${plural(source.documents.total, source.type === "web" ? "page" : "document")} and ${source.documents.total === 1 ? "its" : "their"} passages are deleted. This can't be undone.`}
      confirmLabel="Delete source"
      busy={remove.isPending}
      error={remove.error}
      onConfirm={() => remove.mutate()}
    />
  );

  return { paused, status, toggle, requestDelete: () => setConfirmDelete(true), menuActions, dialog, resumeIcon: <Play aria-hidden /> };
}

/** Why the source can't be deleted yet: the knowledge bases that search it, each linked so it can be detached there. */
function InUseDialog({ open, onClose, source, kbs, team }: { open: boolean; onClose: () => void; source: DataSource; kbs: KB[]; team: string }) {
  const one = kbs.length === 1;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={`${source.name} can't be deleted yet`}
      description={`${one ? "A knowledge base searches" : `${kbs.length} knowledge bases search`} this source. Remove it from ${one ? "that knowledge base" : "them"} on ${one ? "its" : "their"} Sources tab first, then delete it.`}
      footer={<DialogClose>Close</DialogClose>}
    >
      <ul className={w.inUse} aria-label="Knowledge bases that use this source">
        {kbs.map((kb) => (
          <li key={kb.id}>
            <TextLink render={<Link to="/teams/$team/kbs/$kbId" params={{ team, kbId: kb.id }} search={{ tab: "sources" }} />}>{kb.name}</TextLink>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
