/*
 * Admin Overview › Features › OAuth sign-in for MCP clients (experimental;
 * docs/mcp.md, "Signing in with OAuth"): the second setting of the MCP
 * server's settings, off by default and only in effect while the server is
 * on. Platform admins change it (If-Match, audited as platform.mcp_oauth),
 * confirming before they turn it off; auditors see it disabled.
 */
import { api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { FeatureSwitch, useFeatureSave } from "./feature-switch";
import type { FeatureState } from "./feature-text";
import type { useMCPSetting } from "./mcp-switch";
import { mcpServerDocsUrl } from "./mcp-switch";
import { mcpSettingsQuery } from "./queries";

/** How OAuth sign-in works (the self-hosting guide to the MCP server). */
export const oauthDocsUrl = mcpServerDocsUrl;

type Settings = Schemas["MCPSettings"];

/** Saves the OAuth setting, keeping the server's own switch as it is. */
export function useOAuthSave(setting: ReturnType<typeof useMCPSetting>) {
  const { settings } = setting;
  return useFeatureSave({
    put: async (oauthEnabled: boolean) =>
      unwrap(
        await api.PUT("/v1/admin/settings/mcp", {
          params: { header: ifMatch(settings.data!.revision) },
          body: { enabled: settings.data!.enabled, oauthEnabled },
        }),
      ),
    queryKey: mcpSettingsQuery().queryKey,
    alsoInvalidate: [["me"]],
    saved: (st) => (st.oauthEnabled ? "OAuth sign-in for MCP clients is on" : "OAuth sign-in for MCP clients is off"),
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
  return (
    <FeatureSwitch
      label="Allow OAuth sign-in"
      enabled={setting.settings.data?.oauthEnabled}
      save={save}
      busy={setting.save.isPending}
      isAdmin={isAdmin}
      off={{ title: "Turn OAuth sign-in off?", description: offConsequences, confirmLabel: "Turn OAuth sign-in off" }}
    />
  );
}
