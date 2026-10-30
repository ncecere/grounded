import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError, ifMatch, unwrap, type Schemas } from "../../api/client";
import { FormDialog } from "@/components/form-dialog";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { useModels } from "../admin/models/common";
import { ContextualFields } from "./contextual-fields";
import { contextualFormOf, contextualInputOf, validateContextualForm, type ContextualForm } from "./contextual-form";

export function ContextualDialog({ state, queryKey, onClose }: { state: Schemas["ContextualChunks"]; queryKey: readonly unknown[]; onClose: () => void }) {
  const qc = useQueryClient();
  // Freeze the revision with the edits. A background refetch must not silently
  // give old edits a new If-Match token and overwrite someone else's change.
  const [base, setBase] = useState(state);
  const [form, setForm] = useState(() => contextualFormOf(state));
  const set = (patch: Partial<ContextualForm>) => setForm((f) => ({ ...f, ...patch }));
  const models = useModels();
  const available = (models.data ?? []).filter((m) => m.kind === "chat" && m.enabled);
  const errors = validateContextualForm(form);
  const platformBlocked = !base.platformEnabled && form.enabled;
  const save = useMutation({
    mutationFn: async () => unwrap(await api.PUT("/v1/admin/sources/{sourceId}/contextual", {
      params: { path: { sourceId: base.sourceId }, header: ifMatch(base.revision) }, body: contextualInputOf(form),
    })),
    onSuccess: (updated) => {
      qc.setQueryData(queryKey, updated);
      toast.success("Contextual settings saved", "No vectors changed. Build and compare an index preview before switching.");
      onClose();
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey }); },
  });
  const reload = useMutation({
    mutationFn: async () => unwrap(await api.GET("/v1/admin/sources/{sourceId}/contextual", { params: { path: { sourceId: base.sourceId } } })),
    onSuccess: (updated) => {
      setBase(updated);
      setForm(contextualFormOf(updated));
      qc.setQueryData(queryKey, updated);
      save.reset();
    },
  });
  const stale = save.error instanceof ApiError && save.error.status === 412;
  return (
    <FormDialog title="Configure contextual chunks" description="Opt-in, off by default. Saving starts no model request and changes no live vector." size="lg"
      onClose={onClose} submitLabel="Save contextual settings" busy={save.isPending || reload.isPending}
      submitDisabled={platformBlocked || Object.keys(errors).length > 0 || models.isLoading}
      onSubmit={() => { if (!platformBlocked && Object.keys(errors).length === 0) save.mutate(); }}>
      <Switch label="Allow contextual index previews for this source" checked={form.enabled} disabled={!base.platformEnabled && !form.enabled}
        onCheckedChange={(enabled) => set({ enabled })} description="A platform admin must explicitly build, compare and switch the candidate. Existing plain indexes stay unchanged." />
      {!base.platformEnabled && <Alert tone="warning" title="Contextual chunks are switched off for this installation">You can turn this source off, but cannot enable generation while the platform switch is off.</Alert>}
      {form.enabled && <ContextualFields form={form} set={set} models={available} errors={errors} />}
      <ErrorAlert error={models.error} title="Couldn't load context-writing models" />
      {stale ? <Alert tone="warning" title="These settings changed elsewhere" actions={<Button type="button" variant="secondary" onClick={() => reload.mutate()} loading={reload.isPending}>Discard edits and reload</Button>}>
        Your edits are still here and were not saved. Reload explicitly before trying again; there is no force-overwrite.
      </Alert> : <ErrorAlert error={save.error} title="Contextual settings weren't saved" />}
      <ErrorAlert error={reload.error} title="Couldn't reload contextual settings" />
    </FormDialog>
  );
}
