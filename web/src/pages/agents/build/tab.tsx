/*
 * The Build tab (D2 / W2), in the style of a GPT builder: the configuration
 * sections on the left and a live Test chat of the draft on the right, in
 * resizable panes whose sizes are remembered. Below 1100 px the sections
 * fill the width and Test opens as a dialog from the header's Test button
 * (?test=open, so Back closes it).
 */
import { Suspense, lazy, useSyncExternalStore } from "react";
import { Dialog } from "@/components/ui/dialog/dialog";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable/resizable";
import { Loading } from "@/components/ui/spinner/spinner";
import { historyOf } from "../../chat/stream";
import { useChat } from "../../chat/useChat";
import { useTeam } from "../../team/common";
import type { Agent } from "../common";
import type { AgentDraft } from "../draft";
import cf from "./build.module.css";
import type { BuildSection } from "./section";
import { BuildSections } from "./sections";

// The test chat pulls in the Markdown renderer; load it after the sections.
const TestPanel = lazy(() => import("./test-panel").then((m) => ({ default: m.TestPanel })));

/** The window is wide enough for the split (1100 px). Without matchMedia (tests), it is. */
const wideQuery = "(min-width: 68.75rem)";
export function useWideBuild() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = globalThis.matchMedia?.(wideQuery);
      mq?.addEventListener("change", onChange);
      return () => mq?.removeEventListener("change", onChange);
    },
    () => globalThis.matchMedia?.(wideQuery).matches ?? true,
  );
}

const layoutKey = "grounded:agent-build-layout";

function savedLayout(): number[] | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(layoutKey) ?? "null") as unknown;
    return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number") ? v : undefined;
  } catch {
    return undefined;
  }
}

type Props = {
  agent: Agent;
  d: AgentDraft;
  sections: BuildSection[];
  onSectionsChange: (open: BuildSection[]) => void;
  onProblem: (field: string) => void;
  /** The Test dialog (narrow windows only). */
  testOpen: boolean;
  onTestOpenChange: (open: boolean) => void;
};

export function BuildTab({ agent, d, sections, onSectionsChange, onProblem, testOpen, onTestOpenChange }: Props) {
  const { slug } = useTeam();
  const wide = useWideBuild();
  // Kept here, so the conversation survives closing the dialog or resizing the window.
  const chat = useChat({
    path: `/v1/teams/${encodeURIComponent(slug)}/agents/${agent.id}/test`,
    body: (message, previous) => ({ message, history: historyOf(previous), stream: true }),
  });
  const config = <BuildSections key={d.epoch} d={d} open={sections} onOpenChange={onSectionsChange} />;
  const test = (heading: boolean) => (
    <Suspense fallback={<Loading label="Loading the test chat…" />}>
      <TestPanel agent={agent} d={d} chat={chat} onProblem={onProblem} heading={heading} />
    </Suspense>
  );

  if (wide) {
    return (
      <ResizablePanelGroup className={cf.split} defaultLayout={savedLayout()} onLayoutChange={(l) => localStorage.setItem(layoutKey, JSON.stringify(l))}>
        <ResizablePanel id="agent-build-config" defaultSize={58} minSize={40} className={cf.configPane}>
          {config}
        </ResizablePanel>
        <ResizableHandle withHandle label="Resize the test chat" />
        {/* Both sizes given, so the first render (before the group lays out) already has the right widths for the composer to measure. */}
        <ResizablePanel id="agent-build-test" defaultSize={42} minSize={28} className={cf.testPane}>
          {test(true)}
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }
  return (
    <div className={cf.narrow}>
      {config}
      <Dialog
        open={testOpen}
        onOpenChange={onTestOpenChange}
        size="lg"
        title="Test the draft"
        description="Chats with the draft as saved. Answers aren't stored."
      >
        <div className={cf.testDialogBody}>{test(false)}</div>
      </Dialog>
    </div>
  );
}
