/*
 * Admin → Models → Reranking › Test (docs/v0.4.2.md OW-2): a question against a knowledge base the admin picks, searched
 * once without and once with reranking, side by side. It uses the knowledge base's own retrieval (Try it), so it only
 * offers the admin's own teams: platform staff don't read team content without break-glass (ADR-0011).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect } from "@/components/ui/input/input";
import { plainSnippet } from "@/lib/plain-text";
import { rerankScore } from "@/lib/rerank";
import { useCurrentUser } from "@/session";
import s from "../../shared.module.css";
import rr from "./reranking.module.css";

type Hit = Schemas["RetrieveHit"];
type Result = Schemas["RetrieveResult"];

const notes: Record<Schemas["RetrieveRerank"]["status"], string> = {
  ok: "",
  timeout: "Reranking took longer than the time limit, so the search kept the usual order.",
  error: "The rerank model returned an error, so the search kept the usual order.",
  skipped: "The rerank model may not read this knowledge base's classification, so the search kept the usual order.",
};

/** What happened to the reranked search, in one sentence. */
export function rerankOutcome(r?: Schemas["RetrieveRerank"]) {
  if (!r) return "The search wasn't reranked: reranking is off.";
  if (r.status === "ok") return `Reranked the best ${r.candidates.toLocaleString()} passages in ${r.latencyMs.toLocaleString()} ms.`;
  return notes[r.status];
}

const ordinal = (n: number) => `#${n}`;
/** The passage as plain text, without a heading that repeats its title (AD2-11: "### Slices Slices wrap…"). */
export const snippet = (h: Pick<Hit, "content" | "title" | "headingPath">) => {
  const text = plainSnippet(h.content, [h.title, ...(h.headingPath ?? [])]);
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
};
const titleOf = (h: Hit) => h.title || h.filename || "Untitled document";

function useCompare(team: string, kbId: string, query: string) {
  return useMutation({
    mutationFn: async () => {
      const search = async (rerank: boolean) =>
        unwrap(
          await api.POST("/v1/teams/{team}/kbs/{kbId}/retrieve", {
            params: { path: { team, kbId } },
            body: { query: query.trim(), rerank: rerank ? undefined : false },
          }),
        );
      const [before, after] = await Promise.all([search(false), search(true)]);
      return { before, after };
    },
  });
}

/** The test, once searches rerank (`on`). */
export function RerankTestCard({ on }: { on: boolean }) {
  const me = useCurrentUser();
  const teams = me.teams.filter((t) => t.status === "active");
  const [team, setTeam] = useState(teams[0]?.slug ?? "");
  const kbs = useQuery({
    queryKey: ["teams", team, "kbs"],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/kbs", { params: { path: { team } } })),
    enabled: on && team !== "",
  });
  const [kbId, setKbId] = useState("");
  const [query, setQuery] = useState("");
  const kb = kbId || kbs.data?.[0]?.id || "";
  const compare = useCompare(team, kb, query);
  const description = "Search a knowledge base in one of your teams without and with reranking, to see how the order changes. It uses the saved settings.";
  if (!on) {
    return (
      <Card title="Test" description={description}>
        <p className={s.muted}>Choose a rerank model and save the settings to test it.</p>
      </Card>
    );
  }
  if (teams.length === 0) {
    return (
      <Card title="Test" description={description}>
        <p className={s.muted}>You aren't a member of any team. Join one with a knowledge base to test reranking on it.</p>
      </Card>
    );
  }
  return (
    <Card title="Test" description={description}>
      <form
        className={rr.testForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (kb && query.trim()) compare.mutate();
        }}
      >
        <Field label="Team" className={rr.field}>
          <NativeSelect value={team} onChange={(e) => (setTeam(e.target.value), setKbId(""), compare.reset())}>
            {teams.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Knowledge base" className={rr.field} description={kbs.data?.length === 0 ? "This team has no knowledge bases." : undefined}>
          <NativeSelect value={kb} disabled={!kbs.data?.length} onChange={(e) => (setKbId(e.target.value), compare.reset())}>
            {(kbs.data ?? []).map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Question" className={rr.query}>
          {/* Not an example from one knowledge base: the one chosen may be about anything (VI2-10). */}
          <Input maxLength={4000} placeholder="A question someone might ask this knowledge base" value={query} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <div>
          <Button type="submit" variant="secondary" loading={compare.isPending} disabled={!kb || !query.trim()}>
            <FlaskConical aria-hidden /> Compare
          </Button>
        </div>
      </form>
      <ApiErrorAlert error={compare.error} />
      {compare.data && <Comparison before={compare.data.before} after={compare.data.after} />}
    </Card>
  );
}

function Comparison({ before, after }: { before: Result; after: Result }) {
  const was = new Map(before.hits.map((h, i) => [h.chunkId, i + 1]));
  return (
    <div className={rr.compare}>
      <p role="status" className={rr.outcome}>
        {rerankOutcome(after.rerank)}
      </p>
      <section aria-labelledby="rerank-before" className={rr.column}>
        <h3 id="rerank-before" className={rr.columnTitle}>
          Usual order
        </h3>
        <HitList label="Usual order" hits={before.hits} detail={(h) => `Score ${h.score.toFixed(4)}`} />
      </section>
      <section aria-labelledby="rerank-after" className={rr.column}>
        <h3 id="rerank-after" className={rr.columnTitle}>
          Reranked
        </h3>
        <HitList
          label="Reranked"
          hits={after.hits}
          detail={(h, i) => {
            const prev = was.get(h.chunkId);
            const moved = prev === undefined ? "not in the usual top results" : prev === i + 1 ? "same place" : `was ${ordinal(prev)}`;
            return `${h.rerankScore != null ? `Rerank ${rerankScore(h.rerankScore)} · ` : ""}${moved}`;
          }}
        />
      </section>
    </div>
  );
}

function HitList({ label, hits, detail }: { label: string; hits: Hit[]; detail: (h: Hit, i: number) => string }) {
  if (hits.length === 0) return <p className={s.muted}>No matching passages.</p>;
  return (
    <ol aria-label={label} className={rr.hits}>
      {hits.map((h, i) => (
        <li key={h.chunkId} className={rr.hit}>
          <span className={rr.hitTitle}>
            {ordinal(i + 1)} {titleOf(h)}
          </span>
          <span className={rr.hitText}>{snippet(h)}</span>
          <span className={rr.hitDetail}>{detail(h, i)}</span>
        </li>
      ))}
    </ol>
  );
}
