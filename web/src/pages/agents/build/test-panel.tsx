/* Build's live Try it chat: a chat with the saved draft. Nothing is stored; the history is sent with each question. */
import { Eraser } from "lucide-react";
import { useRef, useState } from "react";
import { terms } from "../../../lib/terms";
import { AddToEvaluationsDialog } from "../../team/evaluations/add-to-evaluations";
import { useEvaluationsOn } from "../../team/evaluations/queries";
import { useTeam } from "../../team/common";
import { Button } from "@/components/ui/button/button";
import { ChatPanel } from "../../chat/panel";
import type { useChat } from "../../chat/useChat";
import { type Agent, type AgentProblem, ProblemList } from "../common";
import type { AgentDraft } from "../draft";
import ts from "./test-panel.module.css";

type Props = {
  agent: Agent;
  d: AgentDraft;
  /** The chat, kept by Build so it survives closing the dialog. */
  chat: ReturnType<typeof useChat>;
  onProblem: (field: string) => void;
  /** Show the panel's own heading (the dialog has its title instead). */
  heading?: boolean;
};

export function TestPanel({ agent, d, chat, onProblem, heading = true }: Props) {
  const [text, setText] = useState("");
  const { slug } = useTeam();
  // "Add to evaluations" on any test question (docs/evaluations.md §1).
  const evaluationsOn = useEvaluationsOn();
  const [adding, setAdding] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const p = d.draft.profile;
  const problems = (chat.error?.code === "agent_invalid" ? (chat.error.details?.problems as AgentProblem[] | undefined) : undefined) ?? [];

  return (
    <section aria-labelledby={heading ? "test-heading" : undefined} aria-label={heading ? undefined : "Try the draft"} className={ts.test}>
      <div className={ts.testHead}>
        {heading ? (
          <>
            <h2 id="test-heading" className={ts.testTitle}>
              {terms.tryIt}
            </h2>
            <p className={ts.testNote}>Chats with the draft as saved. Answers aren't stored.</p>
          </>
        ) : (
          <span className={ts.testNote} />
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={chat.items.length === 0 || chat.streaming}
          onClick={() => {
            chat.reset([]);
            inputRef.current?.focus();
          }}
        >
          <Eraser aria-hidden /> Reset
        </Button>
      </div>
      <div className={ts.testPanel}>
        <ChatPanel
          chat={{
            ...chat,
            // Save pending edits first so the test uses them.
            send: async (message: string) => {
              await d.flush();
              return chat.send(message);
            },
          }}
          agent={{ name: p.name || agent.name, accentColor: p.accentColor, welcomeMessage: p.welcomeMessage, starterQuestions: p.starterQuestions, description: p.description }}
          text={text}
          onTextChange={setText}
          inputRef={inputRef}
          label="Draft test conversation"
          errorExtra={problems.length > 0 ? <ProblemList problems={problems} onSelect={onProblem} /> : undefined}
          onAddToEvaluations={evaluationsOn ? setAdding : undefined}
        />
      </div>
      {adding && <AddToEvaluationsDialog team={slug} agentId={agent.id} agentName={agent.name} question={adding} onClose={() => setAdding(null)} />}
    </section>
  );
}
