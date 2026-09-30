/*
 * Admin Overview › Features › MCP server: the platform switch for POST /mcp
 * (docs/mcp.md, docs/v0.3.0.md §3). Off by default; while off, /mcp answers
 * 404 and no AI tool can connect. Platform admins change it (If-Match,
 * audited as platform.mcp), confirming before they turn it off; auditors see
 * it disabled, with the reason.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { lockedSwitch } from "./locked-switch";
import { mcpSettingsQuery } from "./queries";

/**
 * The public documentation site: its pages follow releases, unlike the repository's main branch (existing pages live
 * under /docs, such as /docs/using/chat).
 */
const publicDocs = "https://docs.grounded.bitop.dev/docs";

/** The guide to connecting AI tools (docs/mcp.md in the repository). */
export const mcpDocsUrl = `${publicDocs}/using/mcp`;

/** How the MCP server and its OAuth sign-in work, for the people who run Grounded. */
export const mcpServerDocsUrl = `${publicDocs}/self-hosting/mcp-server`;

/** The MCP server's address on this install. */
export const mcpEndpoint = (origin = window.location.origin) => `${origin}/mcp`;

/** The MCP setting and its save. */
export function useMCPSetting() {
  const qc = useQueryClient();
  const settings = useQuery(mcpSettingsQuery());
  const save = useMutation({
    mutationFn: async (enabled: boolean) =>
      unwrap(await api.PUT("/v1/admin/settings/mcp", { params: { header: ifMatch(settings.data!.revision) }, body: { enabled } })),
    onSuccess: (st) => {
      qc.setQueryData(mcpSettingsQuery().queryKey, st);
      void qc.invalidateQueries({ queryKey: ["me"] });
      toast.success(st.enabled ? "The MCP server is on" : "The MCP server is off");
    },
    onError: () => void qc.invalidateQueries({ queryKey: mcpSettingsQuery().queryKey }),
  });
  return { settings, save };
}

/** What the MCP server does in its current state, for the Features row. */
export function mcpText(enabled: boolean, endpoint = mcpEndpoint()) {
  return enabled
    ? `AI tools connect to ${endpoint} with an API key that has the MCP scope, to search knowledge bases and ask agents.`
    : "No AI tool can connect over MCP. API keys with the MCP scope are kept.";
}

const offConsequences =
  "AI tools connected over MCP stop working at once: the server answers “not found” until it is turned on again. API keys and their scopes are kept.";

/** The switch: platform admins confirm before turning the server off; others see it read-only, with the reason. */
export function MCPSwitch({ setting, isAdmin }: { setting: ReturnType<typeof useMCPSetting>; isAdmin: boolean }) {
  const { settings, save } = setting;
  const [confirming, setConfirming] = useState(false);
  if (!settings.data) return null;
  return (
    <>
      <Switch
        label="Allow MCP clients"
        labelPosition="start"
        checked={settings.data.enabled}
        disabled={save.isPending}
        {...lockedSwitch(isAdmin)}
        onCheckedChange={(v) => (v ? save.mutate(true) : setConfirming(true))}
      />
      <AlertDialog
        open={confirming}
        onOpenChange={(o) => !o && setConfirming(false)}
        title="Turn the MCP server off?"
        description={offConsequences}
        confirmLabel="Turn the MCP server off"
        busy={save.isPending}
        error={save.error}
        onConfirm={() => save.mutate(false, { onSuccess: () => setConfirming(false) })}
      />
    </>
  );
}
