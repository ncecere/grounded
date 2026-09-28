/*
 * "Attach source" (W4): every unattached team and shared source as a choice;
 * the ones that can't be attached are disabled and say why (a different
 * embedding profile, a classification above the team's approval, paused).
 */
import { useState } from "react";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { Loading } from "@/components/ui/spinner/spinner";
import { Database } from "lucide-react";
import type { ClassificationImpact } from "../../sources/owner";
import { type KB, plural, profileName, rankOf, useClassificationLevels, useEmbeddingProfiles, useLevelName, useSharedSources, useSources, useTeam } from "../common";
import { attachCandidates } from "./attach";
import k from "./kbs.module.css";
import type { KBSourceMutations } from "./sources";

type Props = {
  kb: KB;
  attach: KBSourceMutations["attach"];
  onClose: () => void;
  onImpact: (impact: ClassificationImpact) => void;
  impactOf: (err: unknown) => ClassificationImpact | null;
};

export function AttachSourceDialog({ kb, attach, onClose, onImpact, impactOf }: Props) {
  const { slug, team } = useTeam();
  const levels = useClassificationLevels();
  const profiles = useEmbeddingProfiles();
  const sources = useSources(slug);
  const shared = useSharedSources();
  const levelName = useLevelName();
  const candidates = attachCandidates({
    attached: new Set(kb.sources.map((src) => src.id)),
    embeddingProfileId: kb.embeddingProfileId,
    sources: sources.data ?? [],
    shared: shared.data ?? [],
    rank: (c) => rankOf(levels.data, c),
    teamMax: rankOf(levels.data, team.maxClassification),
    profileName: (id) => profileName(profiles.data, id),
    levelName,
    teamMaxName: levelName(team.maxClassification),
  });
  const eligible = candidates.filter((c) => !c.reason);
  const [picked, setPicked] = useState("");
  const choice = picked || eligible[0]?.source.id || "";
  const loading = sources.isLoading || shared.isLoading || levels.isLoading;
  const blocked = candidates.length - eligible.length;

  const option = (c: (typeof candidates)[number]) => ({
    value: c.source.id,
    disabled: Boolean(c.reason),
    label: (
      <span className={k.optionLabel}>
        {c.source.name}
        <span className={k.optionMeta}>
          {c.shared ? "Shared · " : ""}
          {levelName(c.source.classification)} · {plural(c.source.documents.ready, "ready document")}
        </span>
      </span>
    ),
    description: c.reason,
  });

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={`Attach a source to ${kb.name}`}
      description={`Sources must use ${profileName(profiles.data, kb.embeddingProfileId)}, and be classified no higher than your team is approved for.`}
      footer={
        <>
          <DialogClose>{candidates.length === 0 && !loading ? "Close" : "Cancel"}</DialogClose>
          {(loading || candidates.length > 0) && (
          <Button
            disabled={!choice}
            loading={attach.isPending}
            onClick={() =>
              attach.mutate(choice, {
                onSuccess: onClose,
                onError: (err) => {
                  const impact = impactOf(err);
                  if (impact) onImpact(impact);
                },
              })
            }
          >
            Attach source
          </Button>
          )}
        </>
      }
    >
      {loading ? (
        <Loading label="Loading sources…" />
      ) : candidates.length === 0 ? (
        <EmptyState size="compact" icon={<Database />} title="Every data source is already attached." />
      ) : (
        <div className={k.attachList}>
          <ErrorAlert error={sources.error || shared.error || (impactOf(attach.error) ? null : attach.error)} />
          <RadioGroup
            legend="Data source"
            description={blocked > 0 ? `${plural(blocked, "source")} can't be attached; each says why.` : undefined}
            value={choice}
            onValueChange={setPicked}
            options={candidates.map(option)}
          />
        </div>
      )}
    </Dialog>
  );
}
