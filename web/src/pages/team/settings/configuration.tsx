import { useState } from "react";
import { api } from "../../../api/client";
import { SettingsSection } from "../../../components/templates/settings-page";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";

/** Mounted only for actual editors/admins/owners. No request on mount. */
export function ConfigurationExport({ team }: { team: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  async function download() {
    setState("loading");
    try {
      const result = await api.GET("/v1/teams/{team}/configuration", {
        params: { path: { team } },
        parseAs: "text",
      });
      if (!result.response.ok || typeof result.data !== "string") throw new Error("Export refused");
      const url = URL.createObjectURL(new Blob([result.data], { type: "application/yaml" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "team-configuration.yaml";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setState("done");
    } catch {
      setState("error");
    }
  }
  return (
    <SettingsSection title="Configuration as code" description="Download names, settings and portable references as YAML. No uploaded content or secret values. Unsupported settings or protected references refuse the whole download. Import, dry run and apply are not available yet.">
      <Button type="button" disabled={state === "loading"} onClick={() => void download()}>
        {state === "loading" ? "Checking configuration…" : "Export configuration"}
      </Button>
      <div role="status">{state === "done" ? "Configuration checked. Download started." : ""}</div>
      {state === "error" && <Alert tone="danger" title="Configuration could not be exported">Your access may have changed, or this team has unsupported settings, protected evaluation data, unnamed webhook signing secrets or exceeds the export limits. No partial file was downloaded.</Alert>}
    </SettingsSection>
  );
}
