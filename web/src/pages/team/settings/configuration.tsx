import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "../../../api/client";
import { SettingsSection } from "../../../components/templates/settings-page";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import c from "./import-page.module.css";

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
    <SettingsSection title="Configuration as code" description="Export the team's sources, knowledge bases, agents, evaluation sets and webhooks as YAML, or import a file: you see every change before anything is applied. Never uploaded files, passages, conversations or secrets.">
      <div className={c.actions}>
        <Button type="button" variant="secondary" disabled={state === "loading"} onClick={() => void download()}>
          {state === "loading" ? "Checking configuration…" : "Export configuration"}
        </Button>
        <Button variant="secondary" render={<Link to="/teams/$team/settings/configuration" params={{ team }} />}>
          Import configuration…
        </Button>
      </div>
      <div role="status">{state === "done" ? "Configuration checked. Download started." : ""}</div>
      {state === "error" && <Alert tone="danger" title="Configuration could not be exported">Your access may have changed, or this team has settings files do not carry yet (MCP tools, contextual chunks, saved-answer settings, short names), protected evaluation data, or exceeds the export limits. No partial file was downloaded.</Alert>}
    </SettingsSection>
  );
}
