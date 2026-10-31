import { useRef } from "react";
import { Info } from "lucide-react";
import type { Schemas } from "../api/client";
import { Dialog } from "./ui/dialog/dialog";
import { IconButton } from "./ui/button/button";
import c from "./assistant-about.module.css";

/** One disclosure UI for signed-in chat, public chat and the iframe. */
export function AssistantAbout({ about }: { about?: Schemas["AssistantAbout"] }) {
  const title = useRef<HTMLSpanElement>(null);
  if (!about) return null;
  return <Dialog title={<span ref={title} tabIndex={-1}>About this assistant</span>} initialFocus={title} trigger={<IconButton icon={<Info aria-hidden />} label="About this assistant" />}>
    <div className={c.content}>
      <dl>
        <dt>Model</dt><dd>{about.modelLabel}</dd>
        <dt>Audience</dt><dd>{about.audience === "all_authenticated" ? "Signed-in users" : about.audience === "team" ? "Team members" : "Public"}</dd>
        <dt>Sources</dt><dd>{about.sourcesLimited ? "More than 500" : about.sourceCount} configured sources. Names and locations are not disclosed here.</dd>
        <dt>Last known successful processing</dt><dd>{about.lastProcessedAt ? new Date(about.lastProcessedAt).toLocaleString() : "Unknown or beyond the observation limit"}. This is a processing observation, not when the author last edited the source.</dd>
        <dt>Configured checks</dt><dd>Passage judging: {about.passageJudging}. Claim checks: {about.claimChecks}. Moderation: {about.moderation}.</dd>
      </dl>
      <p>Enabled means configured, not that every response passed. Checks can be skipped, unavailable or time out. These checks do not certify this assistant.</p>
      <h2>Data handling</h2>
      <p>{about.retention}</p>
      <p>Application transcript access is for the conversation owner, with an exception for audited, time-limited platform-admin break-glass access. Teams see aggregates and metadata. Failed questions may be grouped to improve answers; sharing an individual question with the team is an explicit opt-in. A signed-in owner may deliberately share a conversation by link.</p>
      <h2>Limitations</h2>
      <p>{about.router ? "Routes questions to another assistant you may use. The destination model, sources and checks may differ; inspect that assistant’s own card." : about.strictlyGrounded ? "Configured to answer from its sources." : "May answer from general knowledge as well as sources."} Models can be wrong, and sources may be incomplete or outdated. Check cited pages. No quality, fairness, privacy or external-provider retention guarantee is made.</p>
      {about.ownershipNote && <><h2>Ownership and contact</h2><p>{about.ownershipNote}</p></>}
      <a href="/accessibility" target="_blank" rel="noreferrer">Platform accessibility statement (opens in a new tab)</a>
    </div>
  </Dialog>;
}
