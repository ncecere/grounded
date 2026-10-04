/*
 * The agent editor's Share tab (W8, docs/phase4-publishing.md §10): Audience
 * first, then Links (short, then the ID link, then the team address, and
 * whether they work without signing in: F-07), then the Widget (only
 * for the Public audience: keys, and the snippet beside a live preview).
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Schemas } from "../../../api/client";
import { QueryView } from "@/components/query-view";
import { Alert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Card } from "@/components/ui/card/card";
import { CodeBlock } from "@/components/ui/code-block/code-block";
import { CopyField } from "@/components/ui/copy-field/copy-field";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { WebPreview, WebPreviewBody, WebPreviewNavigation, WebPreviewOpen, WebPreviewReload } from "@/components/ui/web-preview/web-preview";
import { useTeam } from "../../team/common";
import type { Agent } from "../common";
import type { AgentDraft } from "../draft";
import { AudienceSection } from "./audience";
import { KeysList } from "./keys";
import { type Sharing, sharingQuery } from "./sharing";
import { type WidgetPosition, embedSnippet } from "./snippet";
import sh from "./share.module.css";

type Created = Schemas["PublishableKeyCreated"];

export function ShareTab({ agent, d }: { agent: Agent; d: AgentDraft }) {
  const { slug, isManager } = useTeam();
  const sharing = useQuery(sharingQuery(slug, agent.id));
  const [created, setCreated] = useState<Created | null>(null);
  const published = Boolean(agent.published);
  return (
    <QueryView query={sharing} loadingLabel="Loading sharing…">
      {sharing.data && (
        <div className={sh.share}>
          <Card title="Audience" description="Who can chat with the agent. It's part of the draft, so a change takes effect when you publish.">
            <AudienceSection d={d} sharing={sharing.data} published={published} />
          </Card>
          <LinksCard sharing={sharing.data} published={published} />
          {sharing.data.audience === "public" || d.draft.config.audience === "public" ? (
            <Card title="Widget" description="A chat button that opens the agent in a panel, on the sites you allow.">
              <div className={sh.widget}>
                {sharing.data.audience !== "public" && <Alert tone="info">The widget works once the agent is published to the Public audience.</Alert>}
                {!sharing.data.publicAgentsEnabled && (
                  <Alert tone="warning" title="Public access is off">
                    A platform admin has turned public agents off, so the widget shows an error until it's turned back on.
                  </Alert>
                )}
                <section aria-labelledby="widget-keys" className={sh.widgetPart}>
                  <h3 id="widget-keys" className={sh.subTitle}>
                    Keys
                  </h3>
                  {isManager ? (
                    <KeysList team={slug} agentId={agent.id} onCreated={setCreated} />
                  ) : (
                    <p className={sh.note}>Team admins and owners create the keys that let the widget run on a site.</p>
                  )}
                </section>
                <div className={sh.embedGrid}>
                  <EmbedCode sharing={sharing.data} created={created} />
                  <Preview team={slug} agent={agent} />
                </div>
              </div>
            </Card>
          ) : (
            <Card title="Widget">
              <p className={sh.note}>The embeddable widget is for Public agents. Choose Public under Audience and publish to use it.</p>
            </Card>
          )}
        </div>
      )}
    </QueryView>
  );
}

function LinksCard({ sharing, published }: { sharing: Sharing; published: boolean }) {
  const open = sharing.audience === "public";
  return (
    <Card title="Links" description="Addresses of the agent's chat page. Share the short one when there is one.">
      <div className={sh.links}>
        {/* F-07: which addresses work signed out (all of them for a public agent, none otherwise). */}
        <p className={sh.access}>
          {!published ? (
            <span className={sh.note}>Not published yet: the links work once a version is published.</span>
          ) : open ? (
            <>
              <Badge tone="success">Public</Badge> {signedOutLinks(sharing.links)}
            </>
          ) : (
            <>
              <Badge variant="outline">Sign-in needed</Badge> People sign in first{sharing.audience === "team" ? ", and only team members can chat" : ""}.
            </>
          )}
        </p>
        {sharing.links.short ? (
          <CopyField label="Short address" value={sharing.links.short} />
        ) : (
          <p className={sh.note}>No short address. A platform admin can assign one (Administration › Agents).</p>
        )}
        <CopyField label="Stable address" description="Uses the agent's ID, so it keeps working if the team or agent is renamed." value={sharing.links.id} />
        <CopyField label="Team address" value={sharing.links.team} />
      </div>
    </Card>
  );
}

function EmbedCode({ sharing, created }: { sharing: Sharing; created: Created | null }) {
  const [position, setPosition] = useState<WidgetPosition>("bottom-right");
  const code = embedSnippet({ scriptUrl: sharing.widget.scriptUrl, agentId: sharing.agentId, key: created?.key ?? "pk_…", integrity: sharing.widget.integrity, position });
  return (
    <section aria-labelledby="widget-embed" className={sh.widgetPart}>
      <h3 id="widget-embed" className={sh.subTitle}>
        Embed code
      </h3>
      {created && (
        <CopyField label={`New key: ${created.name}`} name="publishable key" value={created.key} description="Shown once. It's already in the code below: copy the code now." />
      )}
      <RadioGroup
        legend="Position"
        orientation="horizontal"
        value={position}
        onValueChange={setPosition}
        options={[
          { value: "bottom-right", label: "Bottom right" },
          { value: "bottom-left", label: "Bottom left" },
        ]}
      />
      <CodeBlock code={code} language="html" filename="Add to each page on an allowed origin" wrap />
      {!created && <p className={sh.note}>Replace pk_… with a widget key. A key is shown once, when it's created.</p>}
    </section>
  );
}

/** The widget panel as visitors see it, on the current draft (nothing is stored; the real public message limit: P-14). */
function Preview({ team, agent }: { team: string; agent: Agent }) {
  const url = `/embed/${agent.id}?preview=1&team=${encodeURIComponent(team)}`;
  return (
    <section aria-labelledby="widget-preview" className={sh.widgetPart}>
      <h3 id="widget-preview" className={sh.subTitle}>
        Preview
      </h3>
      <WebPreview defaultUrl={url} className={sh.preview}>
        <WebPreviewNavigation>
          <WebPreviewReload />
          <span className={sh.previewLabel}>The draft, as your account</span>
          <WebPreviewOpen />
        </WebPreviewNavigation>
        <WebPreviewBody title={`Widget preview of ${agent.name}`} sandbox="allow-scripts allow-forms allow-same-origin" className={sh.previewFrame} />
      </WebPreview>
    </section>
  );
}

/** Says how many of the shown addresses work signed out, counting the ones there are (BU-16). */
function signedOutLinks(links: Sharing["links"]): string {
  const n = [links.short, links.id, links.team].filter(Boolean).length;
  return n >= 3 ? "All three work without signing in." : n === 2 ? "Both work without signing in." : "It works without signing in.";
}
