/*
 * Web source configuration: the form shared by the create dialog and the
 * settings card. Its logic is in web-form.ts; the map preview and the
 * host_not_allowed explanation are map-preview.tsx and host-errors.tsx.
 */
import { useState } from "react";
import { Disclosure } from "@/components/ui/disclosure/disclosure";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input/input";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { Switch } from "@/components/ui/switch/switch";
import { TagInput } from "@/components/ui/tag-input/tag-input";
import s from "../shared.module.css";
import { MapPreview } from "./map-preview";
import { advancedSummary, lines, modeLabels, scheduleLabels, type WebErrors, type WebFormState, type WebMode, type WebSchedule } from "./web-form";
import w from "./web.module.css";

type SetWeb = (patch: Partial<WebFormState>) => void;

export function WebConfigFields({
  value: f,
  onChange,
  errors,
  preview = true,
}: {
  value: WebFormState;
  onChange: (next: WebFormState) => void;
  /** Validation errors to show (pass them after the first submit). */
  errors: WebErrors;
  /** Offer the map preview (crawl mode, when the owner supports it). */
  preview?: boolean;
}) {
  const set: SetWeb = (patch) => onChange({ ...f, ...patch });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Open the advanced options when one of them is invalid, so the error is visible.
  const advancedInvalid = Boolean(errors.maxDepth || errors.maxPages);

  return (
    <>
      <RadioGroup<WebMode>
        legend="What to index"
        variant="card"
        value={f.mode}
        onValueChange={(mode) => set({ mode })}
        options={[
          { value: "scrape", label: modeLabels.scrape, description: "One web page." },
          { value: "batch", label: modeLabels.batch, description: "Specific pages, one URL per line." },
          { value: "crawl", label: modeLabels.crawl, description: "Start from a page and follow its links." },
        ]}
      />
      <UrlsField f={f} set={set} error={errors.urls} />
      {f.mode === "crawl" && (
        <Disclosure title="Advanced crawl options" summary={advancedSummary(f)} open={advancedOpen || advancedInvalid} onOpenChange={setAdvancedOpen}>
          <AdvancedCrawlOptions f={f} set={set} errors={errors} />
        </Disclosure>
      )}
      {f.mode === "crawl" && preview && <MapPreview form={f} />}
      <Field label="Tags" labelHint="Optional" description="Added to every page, so agents and searches can filter on them. Press Enter after each tag (up to 20).">
        <TagInput value={f.tags} onValueChange={(tags) => set({ tags })} maxTags={20} />
      </Field>
      <Field label="Sync schedule" description="Scheduled syncs fetch the pages again and pick up changes. You can always sync manually.">
        <NativeSelect value={f.schedule} onChange={(e) => set({ schedule: e.target.value as WebSchedule })}>
          {(Object.keys(scheduleLabels) as WebSchedule[]).map((k) => (
            <option key={k} value={k}>
              {scheduleLabels[k]}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </>
  );
}

/** The URL input for the mode: one page, a list of pages, or the crawl's start URLs. */
function UrlsField({ f, set, error }: { f: WebFormState; set: SetWeb; error?: string }) {
  if (f.mode === "scrape") {
    return (
      <Field label="Page URL" error={error}>
        <Input
          aria-required
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://registrar.example.edu/calendar/"
          value={lines(f.urls)[0] ?? ""}
          onChange={(e) => set({ urls: e.target.value })}
        />
      </Field>
    );
  }
  if (f.mode === "batch") {
    return (
      <Field label="Page URLs" description="One URL per line, up to 1,000. Each page is fetched on its own; links aren't followed." error={error}>
        <Textarea
          aria-required
          rows={6}
          spellCheck={false}
          placeholder={"https://registrar.example.edu/refunds/\nhttps://registrar.example.edu/transcripts/"}
          value={f.urls}
          onChange={(e) => set({ urls: e.target.value })}
          className={w.urls}
        />
      </Field>
    );
  }
  return (
    <Field label="Start URLs" description="Where the crawl begins, one per line (up to 20). Links are followed on the same host." error={error}>
      <Textarea
        aria-required
        rows={2}
        spellCheck={false}
        placeholder="https://registrar.example.edu/"
        value={f.urls}
        onChange={(e) => set({ urls: e.target.value })}
        className={w.urls}
      />
    </Field>
  );
}

function AdvancedCrawlOptions({ f, set, errors }: { f: WebFormState; set: SetWeb; errors: WebErrors }) {
  return (
    <>
      <div className={s.grid2}>
        <Field label="Maximum depth" description="Link hops from a start page, 0 to 10." error={errors.maxDepth}>
          <Input type="number" inputMode="numeric" aria-required value={f.maxDepth} onChange={(e) => set({ maxDepth: e.target.value })} />
        </Field>
        <Field label="Maximum pages" description="The crawl stops at this many pages." error={errors.maxPages}>
          <NumberInput maximumFractionDigits={0} aria-required value={f.maxPages} onValueChange={(maxPages) => set({ maxPages })} />
        </Field>
      </div>
      <Field label="Path prefixes" labelHint="Optional" description="Only follow paths that start with these, one per line, such as /admissions/. Leave empty for the whole site.">
        <Textarea rows={2} spellCheck={false} value={f.includePrefixes} onChange={(e) => set({ includePrefixes: e.target.value })} className={w.urls} />
      </Field>
      <Field
        label="Exclude patterns"
        labelHint="Optional"
        description="Skip matching paths, one per line, such as /calendar/**. * matches within a path segment, ** across segments."
      >
        <Textarea rows={2} spellCheck={false} value={f.exclude} onChange={(e) => set({ exclude: e.target.value })} className={w.urls} />
      </Field>
      <Switch
        label="Include subdomains"
        description="Also follow links to subdomains of the start hosts."
        checked={f.allowSubdomains}
        onCheckedChange={(allowSubdomains) => set({ allowSubdomains })}
      />
      <Switch
        label="Use sitemaps"
        description="Also start from the pages listed in robots.txt and sitemap.xml."
        checked={f.useSitemaps}
        onCheckedChange={(useSitemaps) => set({ useSitemaps })}
      />
    </>
  );
}
