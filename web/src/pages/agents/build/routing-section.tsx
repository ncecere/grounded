/* Build → Routing (a router agent, docs/specs/v0.6.0/DESIGN.md §4): what it can send questions to, and what it says when nothing fits. */
import { useQuery } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert/alert";
import { Field } from "@/components/ui/field/field";
import { Textarea } from "@/components/ui/input/input";
import { agentDirectoryQuery } from "../../../api/queries";
import s from "../../shared.module.css";
import a from "../agents.module.css";
import type { SectionProps } from "./section";

/** The most agents one routing request describes to the model (internal/agents MaxRouteCandidates). */
export const maxRouteCandidates = 25;

/** What a router says when nothing fits and its wording is the plain default (internal/agents DefaultNoAgent). */
export const defaultNoAgent = "I couldn't find an assistant here that covers that. Try asking it another way, or ask the people who run this service.";

export function RoutingSection({ c, set, errorFor, agentId }: SectionProps & { agentId: string }) {
  const directory = useQuery(agentDirectoryQuery());
  const reach = (directory.data ?? []).filter((x) => x.routable && !x.router && x.id !== agentId);
  const custom = c.refusalMessage && !/^I couldn't find an answer to that in the sources I have\.?$/.test(c.refusalMessage);
  return (
    <div className={a.stack}>
      <p className={s.note}>
        This agent answers nothing itself. Each question goes to the best of the agents below that the person asking could chat with themselves, and the answer shows which agent gave it, with a link to carry on there.
      </p>
      {directory.isPending ? (
        <p className={s.note}>Looking for agents…</p>
      ) : reach.length === 0 ? (
        <Alert tone="warning" title="No agent can be reached yet">
          A team turns an agent on under its Share tab: Can be reached through routers. Until one is, every question gets the wording below.
        </Alert>
      ) : (
        <section aria-label="Agents this router can reach">
          <p className={s.note}>
            {reach.length === 1 ? "It can reach 1 agent that you can chat with" : `It can reach ${reach.length} agents that you can chat with`}. Everyone is sent only to the ones they may chat with themselves.
          </p>
          <ul>
            {reach.slice(0, maxRouteCandidates).map((x) => (
              <li key={x.id}>
                {x.name} <span className={s.note}>· {x.teamName}</span>
              </li>
            ))}
          </ul>
          {reach.length > maxRouteCandidates && <p className={s.note}>Only the first {maxRouteCandidates}, by name, are considered.</p>}
        </section>
      )}
      <Field label="When nothing fits" description="Sent word for word when no agent covers the question. Leave it as it is for the standard wording." error={errorFor("refusalMessage")}>
        <Textarea
          id="agent-field-refusalMessage"
          rows={2}
          maxLength={500}
          value={custom ? c.refusalMessage : defaultNoAgent}
          onChange={(e) => set({ refusalMessage: e.target.value })}
        />
      </Field>
    </div>
  );
}
