/*
 * A source's lifecycle actions: Pause / Resume and Delete. The header's "…"
 * menu and the Settings Danger zone use the same hook, so there is one
 * confirmation dialog and one set of messages (D3, F-21: "Resume", not
 * "Activate").
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Pause, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ActionItem } from "@/components/templates/action-menu";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { toast } from "@/components/ui/toast/toast";
import { plural } from "../team/common";
import { useInvalidateSource } from "./invalidate";
import { type DataSource, useSourceOwner } from "./owner";

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

  const dialog = (
    <AlertDialog
      open={confirmDelete}
      onOpenChange={(o) => {
        setConfirmDelete(o);
        if (!o) remove.reset();
      }}
      title={`Delete ${source.name}?`}
      description={`${plural(source.documents.total, source.type === "web" ? "page" : "document")} and their passages are deleted. This can't be undone.`}
      confirmLabel="Delete source"
      busy={remove.isPending}
      error={remove.error}
      onConfirm={() => remove.mutate()}
    />
  );

  return { paused, status, toggle, requestDelete: () => setConfirmDelete(true), menuActions, dialog, resumeIcon: <Play aria-hidden /> };
}
