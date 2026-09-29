/*
 * Compare versions: any two published versions, or a version and the draft.
 * The instructions as a text diff, then the other settings that changed, by
 * the names the Build tab uses and with knowledge bases and the model by
 * name (config-rows.ts), SystemOne checks and Safety included.
 */
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "../../api/client";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Card } from "@/components/ui/card/card";
import { DiffViewer } from "@/components/ui/diff-viewer/diff-viewer";
import { Field } from "@/components/ui/field/field";
import { NativeSelect } from "@/components/ui/input/input";
import { Loading } from "@/components/ui/spinner/spinner";
import { Table, Td, Tr } from "@/components/ui/table/table";
import s from "../shared.module.css";
import { agentKey, useKBs, useTeam } from "../team/common";
import { type Agent, type AgentConfig, type AgentVersion, useChatModels } from "./common";
import { type ConfigNames, changedRows } from "./config-rows";
import { useSearchParams } from "@/lib/url-search";
import vs from "./versions.module.css";

/** "draft" or a version number, kept in ?from= and ?to=. */
type Side = "draft" | number;

const parseSide = (v: string | null, fallback: Side): Side => (v === "draft" ? "draft" : v && /^\d+$/.test(v) ? Number(v) : fallback);

function useSide(agent: Agent, side: Side) {
  const { slug } = useTeam();
  return useQuery({
    queryKey: [...agentKey(slug, agent.id), "versions", side],
    queryFn: async () =>
      unwrap(await api.GET("/v1/teams/{team}/agents/{agentId}/versions/{version}", { params: { path: { team: slug, agentId: agent.id, version: side as number } } })),
    enabled: side !== "draft",
  });
}

/**
 * Names for both sides alike: the team's knowledge bases and the chat
 * models, then those the versions recorded (deleted since). Results per
 * search come from each configuration, so an inherited value reads the same
 * on both sides.
 */
function useNames(versions: (AgentVersion | undefined)[]): ConfigNames {
  const { slug } = useTeam();
  const kbs = useKBs(slug);
  const models = useChatModels();
  const names = new Map<string, string>();
  for (const v of versions) {
    if (!v) continue;
    for (const k of v.knowledgeBases) if (k.name) names.set(k.id, k.name);
    names.set(v.chatModelId, v.chatModelName);
  }
  for (const k of kbs.data ?? []) names.set(k.id, k.name);
  for (const m of models.data ?? []) names.set(m.id, m.displayName);
  return {
    model: (id) => (id ? (names.get(id) ?? "A model that no longer exists") : "No model"),
    kb: (k) => `${names.get(k.kbId) ?? "Deleted knowledge base"} (${k.topK ? `${k.topK} results` : "the knowledge base's results per search"})`,
  };
}

/** `describe`: say what the card is for (not when the page's own description already does). */
export function CompareVersions({ agent, draft, versions, describe = true }: { agent: Agent; draft: AgentConfig; versions: AgentVersion[]; describe?: boolean }) {
  const [params, setParams] = useSearchParams();
  const latest = versions[0]?.version;
  const from = parseSide(params.get("from"), latest ?? "draft");
  const to = parseSide(params.get("to"), "draft");
  const a = useSide(agent, from);
  const b = useSide(agent, to);
  const names = useNames([a.data, b.data]);
  const set = (key: "from" | "to", v: string) =>
    setParams((p) => {
      const out = new URLSearchParams(p);
      out.set(key, v);
      return out;
    });
  const name = (v: Side) => (v === "draft" ? "the draft" : `version ${v}`);
  const heading = (v: Side) => (v === "draft" ? "Draft" : `Version ${v}${agent.published?.version === v ? " (live)" : ""}`);
  const before = from === "draft" ? draft : a.data?.config;
  const after = to === "draft" ? draft : b.data?.config;
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
  const changed = before && after ? changedRows(before, after, names) : [];
  return (
    <Card title="Compare" description={describe ? "What changed between two versions, or between a version and the draft." : undefined}>
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
            <section className={vs.compareGroup} aria-labelledby="compare-instructions">
              <h3 id="compare-instructions" className={vs.compareTitle}>
                Instructions
              </h3>
              <DiffViewer
                label={`Instructions: ${name(from)} and ${name(to)}`}
                before={before.instructions}
                after={after.instructions}
                labels={{ before: `Instructions in ${name(from)}`, after: `Instructions in ${name(to)}` }}
                maxHeight="20rem"
              />
            </section>
            <section className={vs.compareGroup} aria-labelledby="compare-settings">
              <h3 id="compare-settings" className={vs.compareTitle}>
                Settings
              </h3>
              {changed.length === 0 ? (
                <p className={s.muted}>No setting changed.</p>
              ) : (
                <Table caption={`Settings that changed from ${name(from)} to ${name(to)}`} columns={["Setting", heading(from), heading(to)]} density="compact">
                  {changed.map((r) => (
                    <Tr key={r.label}>
                      <Td>{r.label}</Td>
                      <Td>{r.before}</Td>
                      <Td>{r.after}</Td>
                    </Tr>
                  ))}
                </Table>
              )}
            </section>
          </>
        ) : null}
      </div>
    </Card>
  );
}
