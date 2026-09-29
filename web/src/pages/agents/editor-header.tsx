/* The agent editor's header pieces (save state, Chat · Try it · Publish) and the alerts under it, including a save conflict (F-04). */
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Circle, CircleAlert, FlaskConical, Loader2, MessageSquare, Upload } from "lucide-react";
import { useId } from "react";
import { errorMessage } from "../../api/client";
import { type ActionItem } from "../../components/templates/action-menu";
import { terms } from "../../lib/terms";
import { Alert } from "@/components/ui/alert/alert";
import { DiffViewer } from "@/components/ui/diff-viewer/diff-viewer";
import { Button } from "@/components/ui/button/button";
import { type Agent, ProblemList } from "./common";
import { overlapping } from "./conflict";
import type { AgentDraft, DraftConflict } from "./draft";
import { saveView } from "./publish-state";
import a from "./agents.module.css";

/** The draft's save state as small text next to the title (Q5, F-26). */
export function SaveIndicator({ d }: { d: AgentDraft }) {
  const v = saveView(d.status, d.held || d.invalidFields.length > 0);
  const Icon = v.busy ? Loader2 : v.tone === "success" ? CheckCircle2 : v.tone === "muted" ? Circle : CircleAlert;
  return (
    <span className={a.saveState} data-tone={v.tone === "muted" ? undefined : v.tone} role="status">
      <Icon aria-hidden className={v.busy ? a.spin : undefined} /> {v.text}
    </span>
  );
}

export function ChatButton({ agent }: { agent: Agent }) {
  return (
    <Button variant="secondary" render={<Link to="/a/$team/$agent" params={{ team: agent.teamSlug, agent: agent.slug }} />}>
      <MessageSquare aria-hidden /> Chat
    </Button>
  );
}

/** Chat (once live) and Try it (narrow Build only): secondary header actions, in the "…" menu on a phone. */
export function secondaryActions(agent: Agent, live: boolean, onTest?: () => void): ActionItem[] {
  return [
    { label: "Chat", icon: <MessageSquare aria-hidden />, render: <Link to="/a/$team/$agent" params={{ team: agent.teamSlug, agent: agent.slug }} />, hidden: !live },
    { label: terms.tryIt, icon: <FlaskConical aria-hidden />, onSelect: onTest, hidden: !onTest },
  ];
}

/** Publish, with the reason when it is disabled (shown under the button and read with it). */
export function PublishAction({ blocked, onPublish }: { blocked?: string; onPublish: () => void }) {
  const reasonId = useId();
  return (
    <div className={a.headerActions}>
      <Button onClick={onPublish} disabled={Boolean(blocked)} aria-describedby={blocked ? reasonId : undefined}>
        <Upload aria-hidden /> Publish
      </Button>
      {blocked && (
        <p id={reasonId} className={a.publishReason}>
          {blocked}
        </p>
      )}
    </div>
  );
}

/** Disabled status, a blocked published version, a stale draft and save errors. */
export function EditorAlerts({ current, d, onProblem }: { current: Agent; d: AgentDraft; onProblem: (field: string) => void }) {
  const publishedWarnings = current.warnings.filter((w) => w.field === "published");
  return (
    <>
      {current.status !== "active" && (
        <Alert tone={current.status === "disabled_by_platform" ? "danger" : "warning"} title={current.status === "disabled_by_platform" ? "Disabled by a platform admin" : "Disabled by your team"}>
          Nobody can chat with this agent.
          {current.disabledReason && <> Reason: {current.disabledReason}</>}
          {current.status === "disabled_by_platform" && " Only a platform admin can enable it."}
        </Alert>
      )}
      {publishedWarnings.length > 0 && (
        <Alert tone="danger" title="The published version is blocked">
          <ul className={a.problemList}>
            {publishedWarnings.map((w, i) => (
              <li key={i}>{w.problem}</li>
            ))}
          </ul>
        </Alert>
      )}
      {d.conflict && <ConflictAlert d={d} />}
      {d.status === "error" && (
        <Alert tone="danger" title="The draft couldn't be saved" role="alert">
          {d.problems.length > 0 ? <ProblemList problems={d.problems} onSelect={onProblem} /> : errorMessage(d.error)}
        </Alert>
      )}
    </>
  );
}

const fieldNames: Record<string, string> = {
  "profile.name": "Name",
  "profile.slug": "Address",
  "profile.description": "Description",
  "profile.accentColor": "Accent colour",
  "profile.welcomeMessage": "Welcome message",
  "profile.starterQuestions": "Starter questions",
  "config.instructions": "Instructions",
};
const fieldName = (f: string) => fieldNames[f] ?? f.replace(/^\w+\./, "").replace(/([A-Z])/g, " $1").toLowerCase();

/** A save conflict (412): keep the user's edits on top of the latest version, or take the latest. */
function ConflictAlert({ d }: { d: AgentDraft }) {
  const c = d.conflict as DraftConflict;
  const clash = overlapping({ ...c, mine: d.draft });
  const mine = d.draft.config.instructions;
  const theirs = c.theirs.config.instructions;
  return (
    <Alert
      tone="warning"
      title="This agent was changed somewhere else"
      actions={
        <>
          <Button size="sm" onClick={() => void d.keepMine()}>
            Keep mine
          </Button>
          <Button size="sm" variant="secondary" onClick={d.takeTheirs}>
            Use theirs
          </Button>
        </>
      }
    >
      <p>
        Your edits haven't been saved and are still in the form. <strong>Keep mine</strong> applies them on top of the latest version; <strong>Use theirs</strong> discards them.
        {clash.length > 0 && <> Both of you changed: {clash.map(fieldName).join(", ")}.</>}
      </p>
      {mine !== theirs && (
        <DiffViewer
          label="Instructions: the latest version and yours"
          before={theirs}
          after={mine}
          defaultMode="split"
          maxHeight="16rem"
          labels={{ before: "Latest instructions", after: "Your instructions" }}
          className={a.conflictCompare}
        />
      )}
    </Alert>
  );
}
