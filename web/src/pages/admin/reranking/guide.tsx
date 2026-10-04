/*
 * Admin → Models → Reranking › Set up reranking (docs/v0.4.2.md OW-2): shown until a rerank model exists, so the page
 * says what reranking needs: a connection to a server that serves /rerank, a model of kind Rerank on it, and choosing
 * it here. Platform admins get a button per step; auditors read the steps.
 */
import { Link } from "@tanstack/react-router";
import { Checklist, type ChecklistStep } from "@/components/ui/checklist/checklist";
import { TextLink } from "@/components/ui/text-link/text-link";

/** How to deploy a reranker and add it (docs/operations/rerank.md; the docs site has no page for it yet). */
export const rerankDocsUrl = "https://github.com/ncecere/grounded/blob/main/docs/operations/rerank.md";

type Inputs = { connections: number; rerankModels: number; chosen: boolean; isAdmin: boolean };

/** The steps and whether each is done (pure, unit-tested). */
export function rerankSteps({ connections, rerankModels, chosen, isAdmin }: Inputs): ChecklistStep[] {
  return [
    {
      id: "connection",
      title: "Connect a server that serves /rerank",
      description: (
        <>
          LiteLLM, vLLM and SGLang serve <code>/rerank</code> for reranker models such as bge-reranker.{" "}
          <TextLink href={rerankDocsUrl} external>
            How to deploy a reranker
          </TextLink>
          .
        </>
      ),
      // A rerank model proves its connection; otherwise any connection may be the one.
      done: rerankModels > 0 || connections > 0,
      action: isAdmin ? { label: "Add connection", render: <Link to="/admin/connections" search={{ form: "new" } as never} /> } : undefined,
    },
    {
      id: "model",
      title: "Add a model of kind Rerank on it",
      description: "Then test it on its page: the test checks that it ranks a passage that answers a question above one that doesn't.",
      done: rerankModels > 0,
      action: isAdmin ? { label: "Add model", render: <Link to="/admin/models" search={{ form: "new", kind: "rerank" } as never} /> } : undefined,
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
      description="A rerank model needs a server that runs it. Until one is chosen, searches use the usual order."
      steps={rerankSteps(props)}
    />
  );
}
