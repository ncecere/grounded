/*
 * A sync that would empty a source, or remove a large share of it, removes nothing and waits for an editor
 * (docs/source-types.md). This is the notice on the source's page and the dialog that shows what would go.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Dialog } from "@/components/ui/dialog/dialog";
import { Loading } from "@/components/ui/spinner/spinner";
import { toast } from "@/components/ui/toast/toast";
import { plural } from "../team/common";
import { type DataSource, type SourceSync, useSourceOwner } from "./owner";
import w from "./held-removals.module.css";

export function HeldRemovalsNotice({ source, sync }: { source: DataSource; sync: SourceSync }) {
  const owner = useSourceOwner();
  const [open, setOpen] = useState(false);
  const many = plural(sync.removalsPending, "document");
  return (
    <>
      <Alert
        tone="warning"
        title={`The last sync would remove ${many}, so it removed nothing`}
        actions={
          owner.canEdit && owner.api.connector ? (
            <Button variant="secondary" onClick={() => setOpen(true)}>
              Review
            </Button>
          ) : undefined
        }
      >
        {sync.removalsReason} A revoked permission, a wrong folder or an outage can look the same as everything being deleted.
        {owner.canEdit ? " Look at what would go, then confirm or keep it." : " An editor decides."}
      </Alert>
      {open && <HeldRemovalsDialog source={source} sync={sync} onClose={() => setOpen(false)} />}
    </>
  );
}

function HeldRemovalsDialog({ source, sync, onClose }: { source: DataSource; sync: SourceSync; onClose: () => void }) {
  const owner = useSourceOwner();
  const qc = useQueryClient();
  const removals = useQuery({
    queryKey: [...owner.keys.syncs(source.id), sync.id, "removals"],
    queryFn: () => owner.api.connector!.removals(source.id, sync.id),
  });
  const decide = useMutation({
    mutationFn: (confirm: boolean) => owner.api.connector!.decideRemovals(source.id, sync.id, confirm),
    onSuccess: (done, confirm) => {
      if (confirm) toast.success("Documents removed", `${plural(done.itemsRemoved, "document")} the provider no longer has.`);
      else toast.info("Documents kept", "The next full sync checks again.");
      qc.invalidateQueries({ queryKey: owner.keys.source(source.id) });
      qc.invalidateQueries({ queryKey: owner.keys.list });
      onClose();
    },
  });
  const docs = removals.data?.documents ?? [];
  const more = sync.removalsPending - docs.length;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Remove ${plural(sync.removalsPending, "document")}?`}
      description="The sync did not find these in the provider. Removing them takes them out of search and answers; if they come back, a later sync adds them again."
      footer={
        <>
          <Button variant="secondary" loading={decide.isPending && decide.variables === false} disabled={decide.isPending} onClick={() => decide.mutate(false)}>
            Keep them
          </Button>
          <Button variant="danger" loading={decide.isPending && decide.variables === true} disabled={decide.isPending || removals.isLoading} onClick={() => decide.mutate(true)}>
            Remove {plural(sync.removalsPending, "document")}
          </Button>
        </>
      }
    >
      <ErrorAlert error={removals.error || decide.error} />
      {removals.isLoading ? (
        <Loading label="Loading the documents…" />
      ) : (
        <>
          <ul className={w.list} aria-label="Documents that would be removed">
            {docs.map((d) => (
              <li key={d.id}>{d.title || d.filename || d.url}</li>
            ))}
          </ul>
          {more > 0 && <p className={w.more}>and {more.toLocaleString()} more.</p>}
        </>
      )}
    </Dialog>
  );
}
