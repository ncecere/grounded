/* Admin → Parsing's Test: reads a built-in sample page with the backend on the form (saved or not) and shows the text and the time. */
import { useMutation } from "@tanstack/react-query";
import { ScanText } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { SettingsSection } from "@/components/templates/settings-page";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { backendLabels, parsingInput, type ParsingForm } from "@/lib/parsing";
import s from "../../shared.module.css";
import p from "./parsing.module.css";

export function TestSection({ form, disabled }: { form: ParsingForm; disabled: boolean }) {
  const test = useMutation({
    mutationFn: async () => {
      const input = parsingInput(form);
      return unwrap(
        await api.POST("/v1/admin/parsing/test", {
          body: { backend: input.backend, visionModelId: input.visionModelId, languages: input.backend === "vision" ? undefined : input.languages },
        }),
      );
    },
  });
  const r = test.data;
  return (
    <SettingsSection
      title="Test"
      description="Read a built-in sample page with the backend chosen above, before or after saving. A vision model's test costs a page's tokens."
      actions={
        <Button size="sm" variant="secondary" disabled={disabled} loading={test.isPending} onClick={() => test.mutate()}>
          <ScanText aria-hidden /> Test
        </Button>
      }
    >
      {!r && !test.error && (
        <p className={s.muted}>{test.isPending ? "Reading the sample page…" : `Press Test to read the sample page with ${backendLabels[form.backend]}.`}</p>
      )}
      <ErrorAlert error={test.error} title="The test couldn't run" />
      {r && !r.ok && (
        <Alert tone="danger" title={`${backendLabels[r.backend]} failed after ${r.latencyMs.toLocaleString()} ms`}>
          {r.error}
        </Alert>
      )}
      {r?.ok && (
        <div className={p.result} aria-live="polite">
          <Alert tone={r.text.trim() ? "success" : "warning"} title={`${backendLabels[r.backend]} read the page in ${r.latencyMs.toLocaleString()} ms`}>
            {[
              r.confidence > 0 ? `Confidence ${Math.round(r.confidence * 100)}%.` : "",
              r.tokensIn + r.tokensOut > 0 ? `${r.tokensIn.toLocaleString()} input and ${r.tokensOut.toLocaleString()} output tokens.` : "",
              r.text.trim() ? "" : "No text came back: check the backend (Tika needs its -full image) and the languages.",
            ]
              .filter(Boolean)
              .join(" ")}
          </Alert>
          <div className={p.columns}>
            <div>
              <h3 className={p.heading}>Read</h3>
              <pre className={s.pre}>{r.text || "(nothing)"}</pre>
            </div>
            <div>
              <h3 className={p.heading}>The page says</h3>
              <pre className={s.pre}>{r.expected}</pre>
            </div>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
