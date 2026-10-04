/*
 * Admin → Models → Reranking › Set up reranking (docs/v0.4.2.md OW-2): shown until a rerank model is chosen, so the
 * page says what reranking needs: a connection to a server that serves /rerank, a model of kind Rerank on it, and
 * choosing it here. Platform admins get a button per step; auditors read the steps. Add connection comes back here
 * (?connection=<id>) and offers to test it; Add model then starts on that connection (AD2-06).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button/button";
import { Checklist, type ChecklistStep } from "@/components/ui/checklist/checklist";
import { TextLink } from "@/components/ui/text-link/text-link";
import { plural } from "../../team/common";
import { connectionTestQuery, type Connection, ProxyErrorText } from "../models/common";
import rr from "./reranking.module.css";

/** How to deploy a reranker and add it (docs/operations/rerank.md; the docs site has no page for it yet). */
export const rerankDocsUrl = "https://github.com/ncecere/grounded/blob/main/docs/operations/rerank.md";

type Inputs = {
  connections: number;
  rerankModels: number;
  chosen: boolean;
  isAdmin: boolean;
  /** The connection just added from step 1 (?connection=<id>). */
  added?: Pick<Connection, "id" | "name">;
};

/** Step 1's test of the connection just added: whether it answers, and what it offers. */
function AddedConnectionTest({ conn }: { conn: Pick<Connection, "id" | "name"> }) {
  const test = useQuery({ ...connectionTestQuery(conn.id), enabled: false });
  const r = test.data;
  return (
    <span className={rr.guideTest}>
      <span>
        {conn.name} was added.{" "}
        <Button size="sm" variant="secondary" loading={test.isFetching} onClick={() => void test.refetch()}>
          <FlaskConical aria-hidden /> Test {conn.name}
        </Button>
      </span>
      <span role="status">
        {test.error
          ? "The test couldn't run. Try again."
          : r?.ok
            ? `Connected in ${r.latencyMs.toLocaleString()} ms. It offers ${plural(r.models.length, "model")}${r.models.length ? `: ${r.models.slice(0, 5).join(", ")}${r.models.length > 5 ? ", …" : ""}` : ""}.`
            : r && <ProxyErrorText error={r.error} />}
      </span>
    </span>
  );
}

/** The steps and whether each is done (pure, unit-tested). */
export function rerankSteps({ connections, rerankModels, chosen, isAdmin, added }: Inputs): ChecklistStep[] {
  return [
    {
      id: "connection",
      title: "Connect a server that serves /rerank",
      description: (
        <>
          LiteLLM, vLLM and SGLang serve <code>/rerank</code> for reranker models such as bge-reranker. A connection you already have works if its server
          does.
          {isAdmin && added && (
            <>
              {" "}
              <AddedConnectionTest conn={added} />
            </>
          )}
        </>
      ),
      // A rerank model proves its connection; otherwise any connection may be the one.
      done: rerankModels > 0 || connections > 0,
      action: isAdmin ? { label: "Add connection", render: <Link to="/admin/connections" search={{ form: "new", from: "reranking" } as never} /> } : undefined,
    },
    {
      id: "model",
      title: "Add a model of kind Rerank on it",
      description: "Then test it on its page: the test checks that it ranks a passage that answers a question above one that doesn't.",
      done: rerankModels > 0,
      action: isAdmin
        ? { label: "Add model", render: <Link to="/admin/models" search={{ form: "new", kind: "rerank", from: "reranking", ...(added ? { connection: added.id } : {}) } as never} /> }
        : undefined,
    },
    {
      id: "choose",
      title: "Choose it here",
      description: "In Settings below. Every search then reranks, and agents can turn it off.",
      done: chosen,
      action: isAdmin && rerankModels > 0 ? { label: "Choose the model", href: "#settings" } : undefined,
    },
  ];
}

export function RerankGuide(props: Inputs) {
  return (
    <Checklist
      title="Set up reranking"
      description={
        <>
          A rerank model needs a server that runs it; until one is chosen, searches keep the usual order.{" "}
          <TextLink href={rerankDocsUrl} external>
            How to deploy a reranker
          </TextLink>
          .
        </>
      }
      steps={rerankSteps(props)}
    />
  );
}
