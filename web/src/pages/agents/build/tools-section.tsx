/*
 * Build → Tools (docs/mcp-client.md): the MCP server tools platform admins
 * approved, which the agent may call while it answers. Each shows the
 * server's own description (what the model reads). A server approved for
 * less sensitive data than the agent's knowledge bases hold can't be
 * chosen; publishing and every call check it again. Tools need a chat model
 * that can call them: when no model can, the section says so and who turns
 * tool support on (a platform admin, in Admin → Models).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, type Schemas, unwrap } from "@/api/client";
import { Alert } from "@/components/ui/alert/alert";
import { Checkbox } from "@/components/ui/checkbox/checkbox";
import { Fieldset } from "@/components/ui/field/field";
import { Loading } from "@/components/ui/spinner/spinner";
import { TextLink } from "@/components/ui/text-link/text-link";
import { useCurrentUser } from "../../../session";
import s from "../../shared.module.css";
import { useClassificationLevels, useKBs, useTeam } from "../../team/common";
import a from "../agents.module.css";
import { useChatModels } from "../common";
import cf from "./build.module.css";
import type { SectionProps } from "./section";

type ToolOption = Schemas["MCPToolOption"];

const maxTools = 10;

export function useMCPToolOptions() {
  return useQuery({ queryKey: ["mcp-tools"], queryFn: async () => unwrap(await api.GET("/v1/mcp-tools")), staleTime: 60_000 });
}

/** The rank of the most sensitive data in the chosen knowledge bases (-1: none yet). */
function useDataRank(kbIds: string[]) {
  const { slug } = useTeam();
  const kbs = useKBs(slug);
  const levels = useClassificationLevels();
  const rankOf = (key?: string | null) => levels.data?.find((l) => l.key === key)?.rank ?? -1;
  const chosen = (kbs.data ?? []).filter((kb) => kbIds.includes(kb.id));
  const rank = Math.max(-1, ...chosen.map((kb) => rankOf(kb.effectiveClassification)));
  return { rank, rankOf, rankName: levels.data?.find((l) => l.rank === rank)?.name ?? "" };
}

/** Why the agent can't call tools: no chat model can (a platform admin turns support on), or the chosen one can't. */
function ModelAlert({ chosen, model }: { chosen: number; model: SectionProps["model"] }) {
  const models = useChatModels();
  const me = useCurrentUser();
  if (!models.data) return null;
  if (!models.data.some((m) => m.supportsTools)) {
    const where = me.capabilities.platformAdmin ? (
      <TextLink render={<Link to="/admin/models" />}>Admin → Models</TextLink>
    ) : (
      "Admin → Models"
    );
    return (
      <Alert tone="warning" title="No chat model can call tools yet.">
        Agents can use tools only with a chat model that supports them. A platform admin turns on tool support for a model in {where}.
        {!me.capabilities.platformAdmin && " Ask one if this agent needs tools."}
      </Alert>
    );
  }
  if (chosen === 0 || !model || model.supportsTools) return null;
  return (
    <Alert tone="warning" title="This chat model can't call tools.">
      Choose a model that can in Model, or remove the tools.
    </Alert>
  );
}

export function ToolsSection({ c, set, errorFor, model, levelName }: SectionProps) {
  const options = useMCPToolOptions();
  const chosen = c.tools ?? [];
  const { rank, rankOf, rankName } = useDataRank(c.kbs.map((k) => k.kbId));
  const models = useChatModels();
  const noToolModel = Boolean(models.data && !models.data.some((m) => m.supportsTools));
  const setOn = (id: string, on: boolean) => set({ tools: on ? [...chosen, id] : chosen.filter((x) => x !== id) });
  const unknown = chosen.filter((id) => !options.data?.some((t) => t.id === id));
  return (
    <div className={a.stack}>
      <Fieldset
        legend="Tools"
        description="Tools from outside services the agent may call while it answers, such as a service status check. Their results are cited like documents. Only the details the agent puts in a call are sent. Only tools a platform admin approved are listed."
      >
        <div id="agent-field-tools" tabIndex={-1} className={cf.kbList}>
          {options.isLoading ? (
            <Loading label="Loading tools…" block={false} />
          ) : (options.data ?? []).length === 0 ? (
            <p className={s.note}>No tools are available yet. Platform admins add MCP servers and approve their tools.</p>
          ) : (
            (options.data ?? []).map((t) => (
              <ToolRow
                key={t.id}
                tool={t}
                checked={chosen.includes(t.id)}
                full={chosen.length >= maxTools || noToolModel}
                aboveCeiling={rank > rankOf(t.maxClassification) ? rankName : undefined}
                levelName={levelName}
                onChange={(on) => setOn(t.id, on)}
              />
            ))
          )}
          {!options.isLoading &&
            unknown.map((id) => (
              <Alert key={id} tone="warning" title="A tool is no longer available">
                Its server was turned off or removed, or the tool is no longer approved.{" "}
                <button type="button" className={a.problemLink} onClick={() => setOn(id, false)}>
                  Remove it from the draft
                </button>
              </Alert>
            ))}
        </div>
        <ModelAlert chosen={chosen.length} model={model} />
        {errorFor("tools") && <p className={s.dangerText}>{errorFor("tools")}</p>}
      </Fieldset>
    </div>
  );
}

type RowProps = {
  tool: ToolOption;
  checked: boolean;
  full: boolean;
  /** The agent's data level when it is above the server's ceiling. */
  aboveCeiling?: string;
  levelName: (key: string) => string;
  onChange: (on: boolean) => void;
};

function ToolRow({ tool, checked, full, aboveCeiling, levelName, onChange }: RowProps) {
  const ceiling = levelName(tool.maxClassification);
  const where = aboveCeiling
    ? `From ${tool.serverName}. Not available: this agent's knowledge is ${aboveCeiling}, and ${tool.serverName} may receive data up to ${ceiling}.`
    : `From ${tool.serverName} · approved for data up to ${ceiling}`;
  return (
    <div>
      <Checkbox
        label={tool.title ? `${tool.title} (${tool.name})` : tool.name}
        description={where}
        checked={checked}
        disabled={!checked && (full || Boolean(aboveCeiling))}
        onCheckedChange={onChange}
      />
      {tool.description && <p className={cf.toolDescription}>{tool.description}</p>}
    </div>
  );
}
