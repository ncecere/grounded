/*
 * The Evaluations tab of a knowledge base and of an agent (docs/evaluations.md
 * §5): the sets that test it, each opening as its own page, and "New set".
 * Editors and above only; the tab is left out while evaluations are off.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ClipboardCheck, FolderOpen, Plus } from "lucide-react";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { FormDialog } from "@/components/form-dialog";
import { ListPage, RelativeTime } from "@/components/templates/list-page";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { Field } from "@/components/ui/field/field";
import { Input, Textarea } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { plural, useTeam } from "../common";
import { pct, runStatus } from "./labels";
import { type EvalSet, evalSetsKey, evalSetsQuery } from "./queries";

export type EvalTarget = { kbId: string; agentId?: undefined; name: string } | { agentId: string; kbId?: undefined; name: string };

/** "Recall@4 83%" or "Pass rate 50%" of the latest run, or its status while it isn't done. */
function lastRunText(set: EvalSet) {
  const r = set.lastRun;
  if (!r) return "Not run yet";
  if (r.status !== "completed") return runStatus[r.status].label;
  return r.kind === "answer" ? `Pass rate ${pct(r.summary.passRate)}` : `Recall@${r.summary.k} ${pct(r.summary.recall)}`;
}

export function EvaluationsTab({ target }: { target: EvalTarget }) {
  const { slug, canEdit } = useTeam();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const filter = target.kbId ? { kbId: target.kbId } : { agentId: target.agentId! };
  const sets = useQuery(evalSetsQuery(slug, filter));
  const open = (id: string) => void navigate({ to: "/teams/$team/evaluations/$setId", params: { team: slug, setId: id } });
  const newSet = canEdit ? (
    <Button onClick={() => setCreating(true)}>
      <Plus aria-hidden /> New set
    </Button>
  ) : undefined;

  const columns: DataTableColumn<EvalSet>[] = [
    {
      id: "name",
      header: "Set",
      rowHeader: true,
      sortable: true,
      accessor: (x) => x.name,
      // The row opens the set (a click, or Enter on its button); its menu has Open.
      cell: (x) => <CellText primary={x.name} secondary={x.description || undefined} />,
    },
    { id: "questions", header: "Questions", sortable: true, accessor: (x) => x.questionCount, cell: (x) => plural(x.questionCount, "question") },
    { id: "last", header: "Latest run", accessor: lastRunText, cell: (x) => <CellText primary={lastRunText(x)} secondary={x.lastRun ? <RelativeTime value={x.lastRun.createdAt} /> : undefined} /> },
    {
      id: "auto",
      header: "Automatic runs",
      accessor: (x) => (x.autoRun ? "On" : "Off"),
      cell: (x) => <StatusBadge tone={x.autoRun ? "success" : "neutral"}>{x.autoRun ? "On" : "Off"}</StatusBadge>,
    },
  ];

  return (
    <Stack gap={4}>
      <PageHeader
        title="Evaluation sets"
        titleAs="h2"
        description={`Test questions for ${target.name}, with the documents a good result should find. Run them after sources or settings change to catch regressions.`}
        actions={newSet}
      />
      <ListPage<EvalSet>
        id="evaluation-sets"
        caption="Evaluation sets"
        columns={columns}
        data={sets.data ?? []}
        getRowId={(x) => x.id}
        rowLabel={(x) => x.name}
        onRowClick={(x) => open(x.id)}
        rowActions={(x) => [{ label: "Open", icon: <FolderOpen aria-hidden />, render: <Link to="/teams/$team/evaluations/$setId" params={{ team: slug, setId: x.id }} /> }]}
        empty={{ icon: <ClipboardCheck />, title: "No evaluation sets yet.", description: "A set is a list of questions with the documents that should answer them.", action: newSet }}
        loading={sets.isLoading}
        error={sets.error}
        onRetry={() => void sets.refetch()}
      />
      {creating && <CreateSetDialog target={target} onClose={() => setCreating(false)} onCreated={open} />}
    </Stack>
  );
}

/** "New set": a name, a description and automatic runs. */
export function CreateSetDialog({ target, onClose, onCreated }: { target: EvalTarget; onClose: () => void; onCreated: (id: string) => void }) {
  const { slug } = useTeam();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [autoRun, setAutoRun] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const nameError = submitted && !name.trim() ? "Enter a name." : undefined;
  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/teams/{team}/evaluation-sets", {
          params: { path: { team: slug } },
          body: { kbId: target.kbId, agentId: target.agentId, name: name.trim(), description: description.trim(), autoRun },
        }),
      ),
    onSuccess: (set) => {
      void qc.invalidateQueries({ queryKey: evalSetsKey(slug) });
      toast.success(`${set.name} was created`);
      onClose();
      onCreated(set.id);
    },
  });
  return (
    <FormDialog
      title="New evaluation set"
      description={`Questions that test ${target.name}.`}
      onClose={onClose}
      submitLabel="Create set"
      busy={create.isPending}
      formProps={{ noValidate: true }}
      onSubmit={() => {
        setSubmitted(true);
        if (name.trim()) create.mutate();
      }}
    >
      <ApiErrorAlert error={create.error} />
      <Field label="Name" error={nameError}>
        <Input aria-required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="Description" labelHint="Optional">
        <Textarea maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Switch
        label="Run automatically"
        description="Retrieval checks after a publish or an embedding profile switch, and nightly when documents change. Editors hear about drops."
        checked={autoRun}
        onCheckedChange={setAutoRun}
      />
    </FormDialog>
  );
}
