/*
 * Admin Overview › Features › OAuth sign-in for MCP clients (experimental;
 * docs/mcp.md, "Signing in with OAuth"): the second setting of the MCP
 * server's settings, off by default and only in effect while the server is
 * on. Platform admins change it (If-Match, audited as platform.mcp_oauth),
 * confirming before they turn it off; auditors see it disabled.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { lockedSwitch } from "./locked-switch";
import type { FeatureState } from "./feature-text";
import type { useMCPSetting } from "./mcp-switch";
import { mcpServerDocsUrl } from "./mcp-switch";
import { mcpSettingsQuery } from "./queries";

/** How OAuth sign-in works (the self-hosting guide to the MCP server). */
export const oauthDocsUrl = mcpServerDocsUrl;

type Settings = Schemas["MCPSettings"];

/** Saves the OAuth setting, keeping the server's own switch as it is. */
export function useOAuthSave(setting: ReturnType<typeof useMCPSetting>) {
  const qc = useQueryClient();
  const { settings } = setting;
  return useMutation({
    mutationFn: async (oauthEnabled: boolean) =>
      unwrap(
        await api.PUT("/v1/admin/settings/mcp", {
          params: { header: ifMatch(settings.data!.revision) },
          body: { enabled: settings.data!.enabled, oauthEnabled },
        }),
      ),
    onSuccess: (st) => {
      qc.setQueryData(mcpSettingsQuery().queryKey, st);
      void qc.invalidateQueries({ queryKey: ["me"] });
      toast.success(st.oauthEnabled ? "OAuth sign-in for MCP clients is on" : "OAuth sign-in for MCP clients is off");
    },
    onError: () => void qc.invalidateQueries({ queryKey: mcpSettingsQuery().queryKey }),
  });
}

/** The row's state and description. */
export function oauthFeature(d: Settings): { state: FeatureState; description: string } {
  if (!d.oauthEnabled) return { state: { label: "Off", tone: "neutral" }, description: "AI tools connect with API keys only." };
  if (!d.enabled) return { state: { label: "On · MCP server off", tone: "neutral" }, description: "Takes effect when the MCP server is on." };
  return {
    state: { label: "On", tone: "success" },
    description: "AI tools can also connect by signing in as the person using them, who approves each app. People disconnect apps on Connected apps, in their account menu.",
  };
}

const offConsequences =
  "Apps connected with OAuth stop working at once, until it's turned on again. People's connections are kept, and API keys keep working.";

/** The switch: platform admins confirm before turning it off; others see it read-only, with the reason. */
export function OAuthSwitch({ setting, save, isAdmin }: { setting: ReturnType<typeof useMCPSetting>; save: ReturnType<typeof useOAuthSave>; isAdmin: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const d = setting.settings.data;
  if (!d) return null;
  return (
    <>
      <Switch
        label="Allow OAuth sign-in"
        labelPosition="start"
        checked={d.oauthEnabled}
        disabled={save.isPending || setting.save.isPending}
        {...lockedSwitch(isAdmin)}
        onCheckedChange={(v) => (v ? save.mutate(true) : setConfirming(true))}
      />
      <AlertDialog
        open={confirming}
        onOpenChange={(o) => !o && setConfirming(false)}
        title="Turn OAuth sign-in off?"
        description={offConsequences}
        confirmLabel="Turn OAuth sign-in off"
        busy={save.isPending}
        error={save.error}
        onConfirm={() => save.mutate(false, { onSuccess: () => setConfirming(false) })}
      />
    </>
  );
}
