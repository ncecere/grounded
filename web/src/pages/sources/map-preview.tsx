import { useMutation } from "@tanstack/react-query";
import { Globe, ListChecks } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import s from "../shared.module.css";
import { plural } from "../team/common";
import { type MapRequest, useSourceOwner } from "./owner";
import w from "./map-preview.module.css";
import { mapRequest, type WebFormState } from "./web-form";
import { WebErrorAlert } from "./host-errors";

/** "Preview pages": discovers the URLs a crawl would start with, without storing anything. */
export function MapPreview({ form }: { form: WebFormState }) {
  const owner = useSourceOwner();
  const req = mapRequest(form);
  const signature = JSON.stringify(req);
  const [ranWith, setRanWith] = useState("");
  const [missingUrl, setMissingUrl] = useState(false);
  const map = useMutation({
    mutationFn: (body: MapRequest) => {
      if (!owner.api.map) throw new Error("Previews aren't available here.");
      return owner.api.map(body);
    },
  });
  if (!owner.api.map || !owner.canEdit) return null;
  const result = map.data;
  const stale = result !== undefined && ranWith !== signature;

  return (
    <section aria-label="Page preview" className={w.preview}>
      <div className={w.previewHeader}>
        <p className={s.note}>
          List pages found from the first start URL, to check the scope. The crawl may fetch them in a different order, so with a page limit it can keep
          a different set. Nothing is saved; this can take up to 30 seconds.
        </p>
        <Button
          variant="secondary"
          size="sm"
          loading={map.isPending}
          onClick={() => {
            if (!req) {
              setMissingUrl(true);
              return;
            }
            setMissingUrl(false);
            setRanWith(signature);
            map.mutate(req);
          }}
        >
          <ListChecks aria-hidden /> Preview pages
        </Button>
      </div>
      {missingUrl && !req && <Alert tone="warning">Enter a valid start URL to preview its pages.</Alert>}
      {map.isPending && (
        <p role="status" className={s.note}>
          Discovering pages…
        </p>
      )}
      {map.error ? <WebErrorAlert error={map.error} urls={req ? [req.url] : []} title="Couldn't preview pages" /> : null}
      {result && !map.isPending && (
        <div className={w.previewResult}>
          <p role="status" className={w.previewCount}>
            {result.urls.length === 0
              ? "No pages found."
              : `${plural(result.urls.length, "page")} found from the start URL${result.sitemapUrls > 0 ? `, ${result.sitemapUrls.toLocaleString()} of them from sitemaps` : ""}. The crawl may fetch pages in a different order.`}
          </p>
          {result.truncated && (
            <Alert tone="warning">Discovery stopped at the page limit or after 30 seconds, so the crawl may find more pages than listed.</Alert>
          )}
          {stale && <Alert tone="info">The options changed since this preview. Preview again to update the list.</Alert>}
          {result.urls.length > 0 && (
            // A focusable scroll area so keyboard users can scroll a long list.
            <ul aria-label="Discovered pages" tabIndex={0} className={w.urlList}>
              {result.urls.map((u) => (
                <li key={u}>
                  <Globe aria-hidden className={w.urlIcon} />
                  <span>{u}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
