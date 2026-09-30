/*
 * The Evaluations tab of a knowledge base and of an agent (docs/evaluations.md
 * §5): the sets that test it, each opening as its own page, with the team
 * Evaluations page's columns (set-columns.tsx: the latest Score, recall@k or
 * pass rate named in its tooltip, and its Trend), and "New set":
 * the knowledge base's header primary on this tab (NewSetButton), or the
 * tab's own secondary button on an agent's page, whose header has its own.
 * Editors and above only; the tab is left out while evaluations are off.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ClipboardCheck, Plus } from "lucide-react";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { FormDialog } from "@/components/form-dialog";
import { ListPage } from "@/components/templates/list-page";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { type DataTableColumn } from "@/components/ui/data-table/data-table";
import { Field } from "@/components/ui/field/field";
import { Input, Textarea } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { useTeam } from "../common";
import { autoRunNotice, smallList } from "./labels";
import { type EvalSet, evalSetsKey, evalSetsQuery } from "./queries";
import { setColumns } from "./set-columns";

export type EvalTarget = { kbId: string; agentId?: undefined; name: string } | { agentId: string; kbId?: undefined; name: string };

/** "New set" and its dialog, which opens the new set. */
export function NewSetButton({ target, variant = "primary" }: { target: EvalTarget; variant?: "primary" | "secondary" }) {
  const { slug } = useTeam();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setCreating(true)}>
        <Plus aria-hidden /> New set
      </Button>
      {creating && (
        <CreateSetDialog
          target={target}
          onClose={() => setCreating(false)}
          onCreated={(id) => void navigate({ to: "/teams/$team/evaluations/$setId", params: { team: slug, setId: id } })}
        />
      )}
    </>
  );
}

/** The tab; `newSetInHeader`: the page's header has "New set" (the knowledge base's), so the tab and its empty state don't repeat it. */
export function EvaluationsTab({ target, newSetInHeader = false }: { target: EvalTarget; newSetInHeader?: boolean }) {
  const { slug, canEdit } = useTeam();
  const filter = target.kbId ? { kbId: target.kbId } : { agentId: target.agentId! };
  const sets = useQuery(evalSetsQuery(slug, filter));
  // Secondary: the agent's page has its own primary action (one per view).
  const newSet = canEdit && !newSetInHeader ? <NewSetButton target={target} variant="secondary" /> : undefined;

  const c = setColumns(slug);
  const columns: DataTableColumn<EvalSet>[] = [
    c.name,
    c.questions,
    c.score,
    c.trend,
    {
      id: "auto",
      header: "Automatic runs",
      defaultHiddenNarrow: true,
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
        empty={{
          icon: <ClipboardCheck />,
          title: "No evaluation sets yet.",
          description: `A set is a list of questions with the documents that should answer them.${newSetInHeader && canEdit ? " Create one with New set above." : ""}`,
          action: newSet,
        }}
        tableProps={smallList}
        loading={sets.isLoading}
        error={sets.error}
        onRetry={() => void sets.refetch()}
      />
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
        {/* No autoFocus: the dialog focuses its first field itself. An input that takes focus while the dialog mounts
            becomes where focus returns on close, and it's gone by then, so focus fell to <body>. */}
        <Input aria-required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description" labelHint="Optional">
        <Textarea maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Switch
        label="Run automatically"
        description={`Retrieval runs after a publish or an embedding profile switch, and nightly when documents change. ${autoRunNotice}`}
        checked={autoRun}
        onCheckedChange={setAutoRun}
      />
    </FormDialog>
  );
}
