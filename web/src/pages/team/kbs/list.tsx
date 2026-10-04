/* Knowledge bases: the list on ListPage (W6: Sources, Used by agents) and the create dialog (the detail page is detail.tsx). */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Library, Plus, Search } from "lucide-react";
import { useId, useState } from "react";
import { api, unwrap } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { ListPage, RelativeTime, timeColumn } from "@/components/templates/list-page";
import { useIntent } from "@/lib/intents";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { Field, Form } from "@/components/ui/field/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input/input";
import { Loading } from "@/components/ui/spinner/spinner";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import s from "../../shared.module.css";
import { ClassificationBadge, type KB, kbsKey, plural, profileName, useClassificationLevels, useEmbeddingProfiles, useKBs, useTeam } from "../common";
import { ReadOnlyNotice } from "../access";
import { ArchivedNotice } from "../layout";
import k from "./kbs.module.css";
import { UsedByAgents, useAgentsByKB } from "./used-by";

export function KBsPage() {
  const { slug, canEdit } = useTeam();
  const kbs = useKBs(slug);
  const levels = useClassificationLevels();
  const profiles = useEmbeddingProfiles();
  const usedBy = useAgentsByKB(slug);
  const [creating, setCreating] = useState(false);
  useIntent("new-kb", () => canEdit && setCreating(true));
  const levelRank = (key?: string | null) => levels.data?.find((l) => l.key === key)?.rank ?? -1;

  const columns: DataTableColumn<KB>[] = [
    {
      id: "name",
      header: "Knowledge base",
      rowHeader: true,
      sortable: true,
      accessor: (kb) => `${kb.name} ${kb.description}`,
      sortFn: (a, b) => a.name.localeCompare(b.name),
      cell: (kb) => (
        <CellText
          primary={
            <TextLink render={<Link to="/teams/$team/kbs/$kbId" params={{ team: slug, kbId: kb.id }} />} className={s.primary}>
              {kb.name}
            </TextLink>
          }
          secondary={kb.description ? <span className={k.oneLine}>{kb.description}</span> : undefined}
        />
      ),
    },
    {
      id: "classification",
      header: "Classification",
      sortable: true,
      filterable: false,
      accessor: (kb) => levelRank(kb.effectiveClassification),
      cell: (kb) => <ClassificationBadge levels={levels.data} value={kb.effectiveClassification} />,
    },
    {
      id: "sources",
      header: "Sources",
      sortable: true,
      accessor: (kb) => kb.sources.length,
      cell: (kb) =>
        kb.sources.length === 0 ? (
          <span className={k.muted}>None</span>
        ) : (
          <span title={kb.sources.map((src) => src.name).join(", ")}>{plural(kb.sources.length, "source")}</span>
        ),
    },
    { id: "usedBy", header: "Used by", sortable: true, filterable: false, accessor: (kb) => usedBy.of(kb.id).length, cell: (kb) => <UsedByAgents uses={usedBy.of(kb.id)} team={slug} /> },
    { id: "profile", header: "Embedding profile", defaultHidden: true, muted: true, accessor: (kb) => profileName(profiles.data, kb.embeddingProfileId) },
    { id: "topK", header: "Passages per search", defaultHidden: true, numeric: true, accessor: "topK" },
    { ...timeColumn<KB>("updated", "Updated", (kb) => kb.updatedAt), cell: (kb) => <span className={k.nowrap}><RelativeTime value={kb.updatedAt} /></span> },
  ];

  return (
    <>
      <ListPage<KB>
        id="team-kbs"
        title="Knowledge bases"
        description="A knowledge base searches one or more data sources. Agents and API keys query knowledge bases."
        primaryAction={
          canEdit && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden /> New knowledge base
            </Button>
          )
        }
        notices={
          <>
            <ArchivedNotice>Its knowledge bases are read-only.</ArchivedNotice>
            <ReadOnlyNotice what="knowledge bases" />
          </>
        }
        caption="Knowledge bases"
        columns={columns}
        data={kbs.data ?? []}
        getRowId={(kb) => kb.id}
        rowLabel={(kb) => kb.name}
        search={{ label: "Search knowledge bases", placeholder: "Name or description" }}
        rowActions={(kb) => [
          { label: "Open", icon: <Library aria-hidden />, render: <Link to="/teams/$team/kbs/$kbId" params={{ team: slug, kbId: kb.id }} /> },
          { label: "Try it", icon: <Search aria-hidden />, render: <Link to="/teams/$team/kbs/$kbId" params={{ team: slug, kbId: kb.id }} search={{ tab: "try" }} /> },
        ]}
        loading={kbs.isLoading}
        error={kbs.error}
        onRetry={() => void kbs.refetch()}
        empty={{
          icon: <Library />,
          title: "No knowledge bases yet.",
          description: "Create a knowledge base, then attach data sources to search them together.",
          action: canEdit && (
            <Button variant="secondary" onClick={() => setCreating(true)}>
              <Plus aria-hidden /> Create a knowledge base
            </Button>
          ),
        }}
        tableProps={{ defaultSort: { columnId: "name", direction: "ascending" } }}
      />
      {creating && <CreateKBDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateKBDialog({ onClose }: { onClose: () => void }) {
  const { slug } = useTeam();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const formId = useId();
  const profiles = useEmbeddingProfiles();
  const [form, setForm] = useState({ name: "", description: "", embeddingProfileId: "", topK: 8 });
  const embeddingProfileId = form.embeddingProfileId || profiles.data?.find((p) => p.isDefault)?.id || profiles.data?.[0]?.id || "";
  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/teams/{team}/kbs", {
          params: { path: { team: slug } },
          body: { name: form.name.trim(), description: form.description, topK: form.topK, embeddingProfileId: embeddingProfileId || undefined },
        }),
      ),
    onSuccess: (kb) => {
      qc.invalidateQueries({ queryKey: kbsKey(slug) });
      toast.success("Knowledge base created", "Attach data sources to start searching.");
      onClose();
      void navigate({ to: "/teams/$team/kbs/$kbId", params: { team: slug, kbId: kb.id } });
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="New knowledge base"
      description="You'll attach data sources after creating it."
      footer={
        <>
          <DialogClose>Cancel</DialogClose>
          <Button type="submit" form={formId} loading={create.isPending} disabled={profiles.isLoading}>
            Create knowledge base
          </Button>
        </>
      }
    >
      {profiles.isLoading ? (
        <Loading />
      ) : (
        <Form
          id={formId}
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <ErrorAlert error={profiles.error} />
          <Field label="Name">
            <Input required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Description" labelHint="Optional">
            <Textarea maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Embedding profile" description="Can't be changed later. Only sources using this profile can be attached.">
            <NativeSelect required value={embeddingProfileId} onChange={(e) => setForm({ ...form, embeddingProfileId: e.target.value })}>
              {(profiles.data ?? []).map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}
                  {pr.isDefault && !/\(default\)/i.test(pr.name) ? " (default)" : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Results per query (top-k)" description="Between 1 and 50.">
            <Input type="number" required min={1} max={50} value={form.topK} onChange={(e) => setForm({ ...form, topK: Number(e.target.value) })} />
          </Field>
          <ApiErrorAlert error={create.error} />
        </Form>
      )}
    </Dialog>
  );
}
