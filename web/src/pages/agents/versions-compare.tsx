/* Versions → Compare: any two published versions, or a version and the draft, as a diff of the instructions and of the other settings. */
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "../../api/client";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Card } from "@/components/ui/card/card";
import { DiffViewer } from "@/components/ui/diff-viewer/diff-viewer";
import { Field } from "@/components/ui/field/field";
import { NativeSelect } from "@/components/ui/input/input";
import { Loading } from "@/components/ui/spinner/spinner";
import s from "../shared.module.css";
import { agentKey, useTeam } from "../team/common";
import { type Agent, type AgentConfig, type AgentVersion, configInput } from "./common";
import { useSearchParams } from "@/lib/url-search";
import vs from "./versions.module.css";

/** "draft" or a version number, kept in ?from= and ?to=. */
type Side = "draft" | number;

const parseSide = (v: string | null, fallback: Side): Side => (v === "draft" ? "draft" : v && /^\d+$/.test(v) ? Number(v) : fallback);

/** The settings compared as JSON: the config without the instructions (shown as text) and with nothing unset. */
function settings(c: AgentConfig) {
  const { instructions: _i, ...rest } = configInput(c);
  return JSON.parse(JSON.stringify(rest)) as unknown;
}

function useSide(agent: Agent, side: Side) {
  const { slug } = useTeam();
  return useQuery({
    queryKey: [...agentKey(slug, agent.id), "versions", side],
    queryFn: async () =>
      unwrap(await api.GET("/v1/teams/{team}/agents/{agentId}/versions/{version}", { params: { path: { team: slug, agentId: agent.id, version: side as number } } })),
    enabled: side !== "draft",
    select: (v: AgentVersion) => v.config,
  });
}

export function CompareVersions({ agent, draft, versions }: { agent: Agent; draft: AgentConfig; versions: AgentVersion[] }) {
  const [params, setParams] = useSearchParams();
  const latest = versions[0]?.version;
  const from = parseSide(params.get("from"), latest ?? "draft");
  const to = parseSide(params.get("to"), "draft");
  const a = useSide(agent, from);
  const b = useSide(agent, to);
  const set = (key: "from" | "to", v: string) =>
    setParams((p) => {
      const out = new URLSearchParams(p);
      out.set(key, v);
      return out;
    });
  const name = (v: Side) => (v === "draft" ? "the draft" : `version ${v}`);
  const before = from === "draft" ? draft : a.data;
  const after = to === "draft" ? draft : b.data;
  const options = (
    <>
      <option value="draft">Draft</option>
      {versions.map((v) => (
        <option key={v.version} value={v.version}>
          Version {v.version}
          {agent.published?.id === v.id ? " (live)" : ""}
        </option>
      ))}
    </>
  );
  return (
    <Card title="Compare" description="What changed between two versions, or between a version and the draft.">
      <div className={vs.compare}>
        <div className={s.grid2}>
          <Field label="From">
            <NativeSelect value={String(from)} onChange={(e) => set("from", e.target.value)}>
              {options}
            </NativeSelect>
          </Field>
          <Field label="To">
            <NativeSelect value={String(to)} onChange={(e) => set("to", e.target.value)}>
              {options}
            </NativeSelect>
          </Field>
        </div>
        {a.isLoading || b.isLoading ? (
          <Loading label="Loading the versions…" />
        ) : a.error || b.error ? (
          <ErrorAlert error={a.error ?? b.error} />
        ) : before && after ? (
          <>
            <DiffViewer
              label={`Instructions: ${name(from)} and ${name(to)}`}
              before={before.instructions}
              after={after.instructions}
              labels={{ before: `Instructions in ${name(from)}`, after: `Instructions in ${name(to)}` }}
              maxHeight="20rem"
            />
            <DiffViewer label={`Settings: ${name(from)} and ${name(to)}`} format="json" before={settings(before)} after={settings(after)} maxHeight="20rem" showModeToggle={false} />
          </>
        ) : null}
      </div>
    </Card>
  );
}
