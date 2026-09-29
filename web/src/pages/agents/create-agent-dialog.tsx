/* The "New agent" dialog (W9): name, then knowledge bases (an agent without one can't answer), the chat model by display name, address and description. Lands on Build with Try it open. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api, unwrap } from "../../api/client";
import { ApiErrorAlert } from "../../components/errors";
import { FormDialog } from "@/components/form-dialog";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Checkbox } from "@/components/ui/checkbox/checkbox";
import { Field, Fieldset } from "@/components/ui/field/field";
import { Input } from "@/components/ui/input/input";
import { ModelSelector } from "@/components/ui/model-selector/model-selector";
import { Loading } from "@/components/ui/spinner/spinner";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import s from "../shared.module.css";
import { agentKey, agentsKey, useClassificationLevels, useKBs, useTeam } from "../team/common";
import { capabilityLabels, modelOptions } from "./build/model-section";
import { defaultConfig, slugify, useChatModels } from "./common";
import a from "./agents.module.css";

type ChatModel = NonNullable<ReturnType<typeof useChatModels>["data"]>[number];
/** Chosen knowledge bases (each searched with its own results per search, C14). */
type Picked = Record<string, true>;

/** Validation of the dialog's fields (shown after the first submit, except the address). */
function newAgentErrors(name: string, slug: string, kbCount: number) {
  return {
    name: !name.trim() ? "Enter a name." : undefined,
    slug: slug && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) ? "Use lower-case letters, digits and hyphens." : undefined,
    kbs: kbCount > 5 ? "Choose at most 5 knowledge bases." : undefined,
  };
}

export function CreateAgentDialog({ onClose }: { onClose: () => void }) {
  const { slug: team } = useTeam();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const models = useChatModels();
  const kbs = useKBs(team);
  const levels = useClassificationLevels();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [modelId, setModelId] = useState("");
  const [picked, setPicked] = useState<Picked>({});
  const [submitted, setSubmitted] = useState(false);
  const shownSlug = slugEdited ? slug : slugify(name);
  const model = models.data?.find((m) => m.id === (modelId || models.data?.[0]?.id));
  const levelName = (key: string) => levels.data?.find((l) => l.key === key)?.name ?? key;
  const rankOf = (key?: string | null) => levels.data?.find((l) => l.key === key)?.rank;
  const chosen = Object.entries(picked);
  const tooSensitive = chosen.filter(([id]) => {
    const kb = kbs.data?.find((k) => k.id === id);
    const r = rankOf(kb?.effectiveClassification);
    const max = rankOf(model?.maxClassification);
    return r !== undefined && max !== undefined && r > max;
  });
  const errors = newAgentErrors(name, shownSlug, chosen.length);
  const valid = !errors.name && !errors.slug && !errors.kbs;

  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/teams/{team}/agents", {
          params: { path: { team } },
          body: {
            name: name.trim(),
            slug: shownSlug || undefined,
            description: description.trim() || undefined,
            config: { ...defaultConfig, chatModelId: model?.id ?? null, kbs: chosen.map(([kbId]) => ({ kbId })) },
          },
        }),
      ),
    onSuccess: (agent) => {
      qc.setQueryData(agentKey(team, agent.id), agent);
      qc.invalidateQueries({ queryKey: agentsKey(team) });
      toast.success("Agent created", "Write its instructions, try it, then publish.");
      onClose();
      // Build with the Test chat open, so the builder sees the agent answer at once.
      void navigate({ to: "/teams/$team/agents/$agentId", params: { team, agentId: agent.id }, search: { test: "open" } as never });
    },
  });

  return (
    <FormDialog
      size="lg"
      title="New agent"
      description="You can change everything later. Nobody can chat with the agent until you publish it."
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (valid) create.mutate();
      }}
      submitLabel="Create agent"
      busy={create.isPending}
      submitDisabled={models.isLoading || kbs.isLoading}
      formProps={{ noValidate: true }}
    >
      <Field label="Name" error={submitted ? errors.name : undefined}>
        <Input aria-required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Fieldset legend="Knowledge bases" description="What the agent answers from (up to 5). Each is searched with its own results per search; you can override them in Build.">
        <KnowledgeBasePicker picked={picked} onChange={setPicked} levelName={levelName} />
        {errors.kbs && <p className={s.dangerText}>{errors.kbs}</p>}
      </Fieldset>
      <ModelPicker model={model} onChange={setModelId} levelName={levelName} />
      <div className={s.grid2}>
        <Field label="Address" labelHint="Optional" description={`Chat link: /a/${team}/${shownSlug || "…"}`} error={errors.slug}>
          <Input
            maxLength={63}
            spellCheck={false}
            value={shownSlug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value.toLowerCase());
            }}
          />
        </Field>
        <Field label="Description" labelHint="Optional" description="Shown in Discover agents.">
          <Input maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
      {tooSensitive.length > 0 && model && (
        <Alert tone="warning" title="The model can't serve these knowledge bases">
          {model.displayName} is approved up to {levelName(model.maxClassification)}. Publishing will fail until you choose another model or other knowledge
          bases.
        </Alert>
      )}
      <ApiErrorAlert error={create.error} />
    </FormDialog>
  );
}

function ModelPicker({ model, onChange, levelName }: { model: ChatModel | undefined; onChange: (id: string) => void; levelName: (key: string) => string }) {
  const models = useChatModels();
  if (models.isLoading) return <Loading label="Loading models…" block={false} />;
  if (models.error) return <ErrorAlert error={models.error} title="Couldn't load chat models" />;
  if ((models.data ?? []).length === 0) {
    return (
      <Alert tone="warning" title="No chat models are available.">
        A platform admin needs to enable a chat model before agents can be published. You can still create a draft.
      </Alert>
    );
  }
  return (
    <Field label="Chat model" description={model ? `Approved up to ${levelName(model.maxClassification)}. ${model.supportsTools ? "Supports tools." : "No tool support."}` : undefined}>
      <div className={a.modelPicker}>
        <ModelSelector label="Chat model" models={modelOptions(models.data ?? [], levelName)} value={model?.id ?? null} capabilityLabels={capabilityLabels} onValueChange={(id) => id && onChange(id)} />
      </div>
    </Field>
  );
}

function KnowledgeBasePicker({ picked, onChange, levelName }: { picked: Picked; onChange: (p: Picked) => void; levelName: (key: string) => string }) {
  const { slug: team } = useTeam();
  const kbs = useKBs(team);
  if (kbs.isLoading) return <Loading label="Loading knowledge bases…" block={false} />;
  if ((kbs.data ?? []).length === 0) {
    return (
      <p className={s.note}>
        Your team has no knowledge bases yet. <TextLink render={<Link to="/teams/$team/kbs" params={{ team }} />}>Create one</TextLink> first; you can add it to the
        agent later.
      </p>
    );
  }
  return (
    <ul className={a.kbPick}>
      {(kbs.data ?? []).map((kb) => {
        const on = kb.id in picked;
        return (
          <li key={kb.id} className={a.kbPickRow}>
            <Checkbox
              label={kb.name}
              description={`${kb.effectiveClassification ? `Classification: ${levelName(kb.effectiveClassification)}` : "No sources attached"} · ${kb.topK} results per search`}
              checked={on}
              onCheckedChange={(checked) => {
                const next = { ...picked };
                if (checked) next[kb.id] = true;
                else delete next[kb.id];
                onChange(next);
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}
