/*
 * Start a migration: pick a knowledge base and a target profile; the
 * preflight shows the sources, the estimate (documents, passages, requests,
 * tokens and time at the connection's request limit), blockers and
 * warnings. Start stays disabled while anything blocks it.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { FormDialog } from "@/components/form-dialog";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { DescriptionList } from "@/components/ui/description-list/description-list";
import { Field } from "@/components/ui/field/field";
import { NativeSelect } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { Loading } from "@/components/ui/spinner/spinner";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { toast } from "@/components/ui/toast/toast";
import s from "../../shared.module.css";
import { type AdminKB, adminKBsQuery, estimateItems, migrationsKey, type Migration, type Preflight } from "./common";
import p from "./profile-migrations.module.css";

type Props = { initialKB?: string; onClose: () => void; onStarted: (m: Migration) => void };

const kbLabel = (kb: AdminKB) => `${kb.name} (${kb.teamName}) · ${kb.profile.name}`;

export function StartMigrationDialog({ initialKB, onClose, onStarted }: Props) {
  const qc = useQueryClient();
  const kbs = useQuery(adminKBsQuery());
  const profiles = useQuery({ queryKey: ["admin", "profiles"], queryFn: async () => unwrap(await api.GET("/v1/admin/embedding-profiles")) });
  const [kbId, setKB] = useState(initialKB ?? "");
  const [target, setTarget] = useState("");
  const [grace, setGrace] = useState<string | null>(null);
  const kb = kbs.data?.find((k) => k.id === kbId);
  const targets = (profiles.data ?? []).filter((x) => x.id !== kb?.profile.id);
  const preflight = useQuery({
    queryKey: ["admin", "profile-migrations", "preflight", kbId, target],
    enabled: Boolean(kbId && target),
    queryFn: async () => unwrap(await api.POST("/v1/admin/profile-migrations/preflight", { body: { kbId, targetProfileId: target } })),
  });
  const pf = preflight.data;
  const graceDays = grace === null || grace === "" ? pf?.defaultGraceDays : Number(grace);
  const graceInvalid = graceDays !== undefined && (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 90);
  const start = useMutation({
    mutationFn: async () => unwrap(await api.POST("/v1/admin/profile-migrations", { body: { kbId, targetProfileId: target, graceDays } })),
    onSuccess: (m) => {
      void qc.invalidateQueries({ queryKey: migrationsKey });
      void qc.invalidateQueries({ queryKey: ["admin", "knowledge-bases"] });
      toast.success(m.status === "switched" ? `${m.kb.name} switched to ${m.toProfile.name}` : `Moving ${m.kb.name} to ${m.toProfile.name}`);
      onStarted(m);
    },
  });
  const blocked = !pf || pf.blockers.length > 0 || graceInvalid;

  return (
    <FormDialog
      title="Migrate a knowledge base"
      description="Re-embeds every source into another embedding profile in the background. The knowledge base keeps searching its current profile until all sources are done, then switches in one step."
      size="lg"
      onClose={onClose}
      onSubmit={() => !blocked && start.mutate()}
      submitLabel="Start migration"
      busy={start.isPending}
      submitDisabled={blocked || preflight.isFetching}
    >
      <ErrorAlert error={kbs.error ?? profiles.error ?? start.error} />
      <div className={s.grid2}>
        <Field label="Knowledge base">
          <NativeSelect value={kbId} onChange={(e) => setKB(e.target.value)} required>
            <option value="">Choose a knowledge base…</option>
            {(kbs.data ?? []).map((k) => (
              <option key={k.id} value={k.id}>
                {kbLabel(k)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Target profile" description={kb ? `Now on ${kb.profile.name}.` : undefined}>
          <NativeSelect value={target} onChange={(e) => setTarget(e.target.value)} required disabled={!kb}>
            <option value="">Choose a profile…</option>
            {targets.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {x.dimensions} dims · {x.chunkSize} tokens{x.status === "retired" ? " (retired)" : ""}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {preflight.isLoading && <Loading label="Checking the migration…" />}
      <ErrorAlert error={preflight.error} title="Couldn't check the migration" />
      {pf && <PreflightView pf={pf} />}
      {pf && (
        <Field
          label="Keep old vectors for"
          labelHint="days"
          description={`Switch back is possible for this long after the switch (0–90; the default is ${pf.defaultGraceDays}). 0 deletes the old vectors at once.`}
          error={graceInvalid ? "Enter a whole number of days from 0 to 90." : undefined}
        >
          <NumberInput value={grace ?? String(pf.defaultGraceDays)} onValueChange={setGrace} maximumFractionDigits={0} className={p.days} />
        </Field>
      )}
    </FormDialog>
  );
}

export function PreflightView({ pf }: { pf: Preflight }) {
  return (
    <Stack gap={4}>
      {pf.blockers.map((b) => (
        <Alert key={b.code} tone="danger" title="Can't start">
          {b.message}
        </Alert>
      ))}
      <DescriptionList items={estimateItems(pf.estimate)} />
      <Table caption={`Sources in ${pf.kb.name}`} columns={["Source", { label: "Documents", numeric: true }, { label: "Passages", numeric: true }, "Also used by"]} density="compact" framed>
        {pf.sources.map((src) => (
          <Tr key={src.id}>
            <Td>
              <span className={p.sourceName}>
                {src.name}
                {src.shared && <Badge size="sm">Shared</Badge>}
                {src.alreadyEmbedded && (
                  <Badge size="sm" tone="success">
                    Already embedded
                  </Badge>
                )}
              </span>
            </Td>
            <Td numeric>{src.documents.toLocaleString()}</Td>
            <Td numeric>{src.passages.toLocaleString()}</Td>
            <Td muted>{src.otherKnowledgeBases ? `${src.otherKnowledgeBases} other ${src.otherKnowledgeBases === 1 ? "knowledge base" : "knowledge bases"}` : "—"}</Td>
          </Tr>
        ))}
      </Table>
      {pf.warnings.length > 0 && (
        <Alert tone="info" title="Good to know">
          <ul className={p.list}>
            {pf.warnings.map((w) => (
              <li key={w.code}>{w.message}</li>
            ))}
          </ul>
        </Alert>
      )}
      <p className={s.settingDescription}>
        Target: {pf.target.name} ({pf.target.model}, {pf.target.dimensions} dimensions, {pf.target.storageType}, passages of up to {pf.target.chunkSize} tokens). Maintenance mode is{" "}
        {pf.maintenance ? "on" : "off"}; it's optional and pauses new ingestion, not the migration.
      </p>
    </Stack>
  );
}
