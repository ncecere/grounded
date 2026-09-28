/*
 * Repeated-boilerplate suppression on a source's Overview (ADR-0021): how many
 * repeated blocks (navigation, footers, "related" cards) are left out of the
 * source's chunks, a disclosure listing the most repeated ones so owners can
 * see what is suppressed, and, for editors, the on/off switch.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Card } from "@/components/ui/card/card";
import { Disclosure } from "@/components/ui/disclosure/disclosure";
import { Spinner } from "@/components/ui/spinner/spinner";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { plural } from "../team/common";
import { useInvalidateSource } from "./invalidate";
import { type DataSource, useSourceOwner } from "./owner";
import b from "./boilerplate.module.css";

/** "12 repeated blocks removed from 147 pages", or why there are none. */
export function boilerplateHeadline(source: DataSource): string {
  const bp = source.boilerplate;
  const unit = source.type === "web" ? "page" : "document";
  if (!bp.enabled) return bp.repeatedBlocks > 0 ? "Turning off: repeated blocks are being restored." : "Off: repeated blocks are kept.";
  if (bp.repeatedBlocks === 0) return bp.pending ? "Checking for repeated blocks…" : "No repeated blocks found.";
  return `${plural(bp.repeatedBlocks, "repeated block")} removed from ${plural(bp.pagesAffected, unit)}`;
}

/** The rule in force, e.g. "Blocks in at least 40 of 200 pages (5 or 20%, whichever is more)". */
export function boilerplateRule(source: DataSource): string {
  const bp = source.boilerplate;
  const unit = source.type === "web" ? "pages" : "documents";
  const pct = `${Math.round(bp.ratio * 100)}%`;
  const rule = `${bp.minDocs} or ${pct}, whichever is more`;
  if (bp.documentsCounted === 0) return `Blocks repeated in at least ${rule} of the ${unit}; one copy is kept.`;
  // Too few to count anything as repeated yet.
  if (bp.threshold > bp.documentsCounted)
    return `Blocks repeated in at least ${bp.threshold} ${unit} (${rule}); with ${bp.documentsCounted} ${bp.documentsCounted === 1 ? unit.slice(0, -1) : unit} so far, none are removed yet.`;
  return `Blocks in at least ${bp.threshold} of ${bp.documentsCounted} ${unit} (${rule}); one copy is kept.`;
}

export function BoilerplateCard({ source }: { source: DataSource }) {
  const owner = useSourceOwner();
  const bp = source.boilerplate;
  const [open, setOpen] = useState(false);
  if (!bp.enabled && bp.repeatedBlocks === 0 && !owner.canEdit) return null;
  return (
    <Card title="Repeated blocks" titleAs="h2" description="Text that repeats across many pages is left out of search, so answers cite real content.">
      <div className={b.body}>
        <p className={b.headline} aria-live="polite">
          {bp.pending && <Spinner size="sm" label="Updating" />}
          <span>{boilerplateHeadline(source)}</span>
        </p>
        {bp.enabled && <p className={b.rule}>{boilerplateRule(source)}</p>}
        {bp.repeatedBlocks > 0 && (
          <Disclosure title="Show the most repeated blocks" open={open} onOpenChange={setOpen}>
            {open && <TopBlocks source={source} />}
          </Disclosure>
        )}
        {owner.canEdit && <EnabledSwitch source={source} />}
      </div>
    </Card>
  );
}

function TopBlocks({ source }: { source: DataSource }) {
  const owner = useSourceOwner();
  const unit = source.type === "web" ? "page" : "document";
  const blocks = useQuery({
    queryKey: [...owner.keys.source(source.id), "boilerplate", source.boilerplate.repeatedBlocks],
    queryFn: () => owner.api.boilerplate(source.id),
  });
  if (blocks.isLoading) return <Spinner size="sm" label="Loading repeated blocks" />;
  if (blocks.error) return <ErrorAlert error={blocks.error} title="Couldn't load the repeated blocks" />;
  return (
    <ol className={b.list} aria-label="Most repeated blocks">
      {(blocks.data ?? []).map((blk, i) => (
        <li key={i} className={b.item}>
          <span className={b.text}>{blk.text ? `${blk.text}${blk.text.length >= 80 ? "…" : ""}` : <em>(text unavailable)</em>}</span>
          <span className={b.count}>{plural(blk.documents, unit)}</span>
        </li>
      ))}
    </ol>
  );
}

function EnabledSwitch({ source }: { source: DataSource }) {
  const owner = useSourceOwner();
  const qc = useQueryClient();
  const invalidate = useInvalidateSource(source);
  const bp = source.boilerplate;
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => owner.api.update(source, { boilerplate: { ...bp.overrides, enabled } }),
    onSuccess: (updated) => {
      qc.setQueryData(owner.keys.source(source.id), updated);
      toast.success(
        updated.boilerplate.enabled ? "Repeated blocks will be removed" : "Repeated blocks will be kept",
        "The pages are re-checked in the background.",
      );
    },
    onSettled: invalidate,
  });
  return (
    <>
      <Switch
        label="Remove repeated blocks"
        description="Changing this re-checks every page from its stored text; nothing is fetched again."
        checked={bp.enabled}
        disabled={toggle.isPending}
        onCheckedChange={(v) => toggle.mutate(v)}
      />
      {toggle.error ? <ErrorAlert error={toggle.error} title="Couldn't change the setting" /> : null}
    </>
  );
}
