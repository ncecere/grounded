/*
 * Preview new settings (#18): copy a knowledge base's embedding profile with some settings changed, build the new index beside the live one and
 * compare them on the knowledge base's evaluation sets before anything switches. Only the settings that are filled in change; the rest keep the
 * current profile's. Nothing the team uses changes until a platform admin switches.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { FormDialog } from "@/components/form-dialog";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect } from "@/components/ui/input/input";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { toast } from "@/components/ui/toast/toast";
import s from "../../shared.module.css";
import { ParentSizeField } from "../models/parents";
import { parentProblem, parentSummary } from "../models/parent-size";
import { adminKBsQuery, type Migration, migrationsKey } from "./common";
import p from "./profile-migrations.module.css";

type Props = { initialKB?: string; onClose: () => void; onStarted: (m: Migration) => void };

const kbLabel = (name: string, team: string, profile: string) => `${name} (${team}) · ${profile}`;

/** A whole number from a form field, or undefined when it is blank or not one. */
const whole = (v: string) => (v.trim() !== "" && Number.isInteger(Number(v)) ? Number(v) : undefined);

export function PreviewDialog({ initialKB, onClose, onStarted }: Props) {
  const qc = useQueryClient();
  const kbs = useQuery(adminKBsQuery());
  const profiles = useQuery({ queryKey: ["admin", "profiles"], queryFn: async () => unwrap(await api.GET("/v1/admin/embedding-profiles")) });
  const models = useQuery({ queryKey: ["admin", "models"], queryFn: async () => unwrap(await api.GET("/v1/admin/models")) });
  const [kbId, setKB] = useState(initialKB ?? "");
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [size, setSize] = useState("");
  const [overlap, setOverlap] = useState("");
  const [docPrefix, setDocPrefix] = useState("");
  const [queryPrefix, setQueryPrefix] = useState("");
  const [chunker, setChunker] = useState(""); // "" keeps the current profile's
  const [parent, setParent] = useState(""); // "" keeps the current profile's, 0 turns parent sections off
  const [grace, setGrace] = useState("");
  const kb = kbs.data?.find((k) => k.id === kbId);
  const live = profiles.data?.find((x) => x.id === kb?.profile.id);
  const embeddingModels = (models.data ?? []).filter((m) => m.kind === "embedding" && m.enabled);
  const parentInvalid = parentProblem(parent, whole(size) ?? live?.chunkSize ?? 0);
  const changes = {
    ...(name.trim() ? { name: name.trim() } : {}),
    ...(model ? { modelId: model } : {}),
    ...(whole(size) !== undefined ? { chunkSize: whole(size) } : {}),
    ...(whole(overlap) !== undefined ? { chunkOverlap: whole(overlap) } : {}),
    ...(docPrefix !== "" ? { documentPrefix: docPrefix } : {}),
    ...(queryPrefix !== "" ? { queryPrefix } : {}),
    ...(chunker !== "" ? { chunkerVersion: Number(chunker) } : {}),
    ...(parent.trim() !== "" && parentInvalid === undefined ? { parentTokens: Number(parent) } : {}),
  };
  const graceDays = whole(grace);
  const graceInvalid = grace.trim() !== "" && (graceDays === undefined || graceDays < 0 || graceDays > 90);
  const start = useMutation({
    mutationFn: async () => unwrap(await api.POST("/v1/admin/profile-migrations/preview", { body: { kbId, changes, ...(graceDays !== undefined ? { graceDays } : {}) } })),
    onSuccess: (m) => {
      void qc.invalidateQueries({ queryKey: migrationsKey });
      void qc.invalidateQueries({ queryKey: ["admin", "knowledge-bases"] });
      void qc.invalidateQueries({ queryKey: ["admin", "profiles"] });
      toast.success(`Building the new index of ${m.kb.name}`);
      onStarted(m);
    },
  });
  const nothingChanged = kbId !== "" && Object.keys(changes).length === 0;

  return (
    <FormDialog
      title="Preview new settings"
      description="Builds a new index of a knowledge base with changed settings beside the current one, runs its evaluation sets on both, and waits. The knowledge base keeps searching its current index until you switch."
      size="lg"
      onClose={onClose}
      onSubmit={() => kbId && !graceInvalid && parentInvalid === undefined && start.mutate()}
      submitLabel="Build the new index"
      busy={start.isPending}
      submitDisabled={!kbId || graceInvalid || parentInvalid !== undefined}
    >
      <ErrorAlert error={kbs.error ?? profiles.error ?? models.error ?? start.error} />
      <Field label="Knowledge base">
        <NativeSelect value={kbId} onChange={(e) => setKB(e.target.value)} required>
          <option value="">Choose a knowledge base…</option>
          {(kbs.data ?? []).map((k) => (
            <option key={k.id} value={k.id}>
              {kbLabel(k.name, k.teamName, k.profile.name)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <p className={s.settingDescription}>
        {live
          ? `Now: ${live.name} · ${live.chunkSize} tokens per passage, ${live.chunkOverlap} overlap, ${live.chunkerVersion === 2 ? "chunker: merge short sections" : "standard chunker"}, ${parentSummary(live.parentTokens)}. Leave a setting empty to keep it.`
          : "Fill in only what should change; the rest keeps the current profile's."}
      </p>
      <div className={s.grid2}>
        <Field label="Passage size" labelHint="tokens" description="64 to 8192.">
          <NumberInput value={size} onValueChange={setSize} maximumFractionDigits={0} placeholder={live ? String(live.chunkSize) : undefined} />
        </Field>
        <Field label="Passage overlap" labelHint="tokens" description="Smaller than the passage size.">
          <NumberInput value={overlap} onValueChange={setOverlap} maximumFractionDigits={0} placeholder={live ? String(live.chunkOverlap) : undefined} />
        </Field>
        <Field label="Embedding model" description="A new model embeds again from the stored text.">
          <NativeSelect value={model} onChange={(e) => setModel(e.target.value)} disabled={!kb}>
            <option value="">Keep {live ? live.model.displayName : "the current model"}</option>
            {embeddingModels
              .filter((m) => m.id !== live?.model.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field label="Chunker" description="How pages are cut into passages. Merge short sections joins short neighbouring sections and drops passages that are only a heading.">
          <NativeSelect value={chunker} onChange={(e) => setChunker(e.target.value)} disabled={!kb}>
            <option value="">Keep the current chunker</option>
            <option value="1">Standard: a new passage at every heading</option>
            <option value="2">Merge short sections</option>
          </NativeSelect>
        </Field>
        <ParentSizeField value={parent} onChange={setParent} error={parentInvalid} preview={{ current: live?.parentTokens ?? 0 }} disabled={!kb} />
        <Field label="Name" description="Shown while it is a preview. Default: the profile's name and (new settings).">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </Field>
        <Field label="Document prefix" description="Added before each passage when it is embedded.">
          <Input value={docPrefix} onChange={(e) => setDocPrefix(e.target.value)} maxLength={200} placeholder={live?.documentPrefix || undefined} />
        </Field>
        <Field label="Query prefix" description="Added before each question when it is embedded.">
          <Input value={queryPrefix} onChange={(e) => setQueryPrefix(e.target.value)} maxLength={200} placeholder={live?.queryPrefix || undefined} />
        </Field>
      </div>
      <Field
        label="Keep old vectors for"
        labelHint="days"
        description="If you switch, switching back is possible for this long (0 to 90; empty uses the install's default)."
        error={graceInvalid ? "Enter a whole number of days from 0 to 90." : undefined}
      >
        <NumberInput value={grace} onValueChange={setGrace} maximumFractionDigits={0} className={p.days} />
      </Field>
      {nothingChanged && <p className={s.settingDescription}>Nothing is filled in, so the new index will be identical to the current one (useful to check that a comparison shows no change).</p>}
    </FormDialog>
  );
}
