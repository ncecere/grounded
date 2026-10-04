/*
 * The agent editor's Settings tab (C13), like a source's and a knowledge
 * base's: General (name, address, description), Saved answers (the answer
 * cache, answer-cache.tsx, which saves through its own API) and the Danger
 * zone (disable or enable, delete). The fields are part of the editor's draft,
 * so they save on their own like the rest of the editor (no save bar), and
 * reach people at once: they aren't part of versions. Look and welcome stay
 * in Appearance.
 */
import { DangerAction, DangerZone, SettingsSection } from "@/components/templates/settings-page";
import { Alert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Field } from "@/components/ui/field/field";
import { Input, Textarea } from "@/components/ui/input/input";
import { useTeam } from "../team/common";
import type { Agent } from "./common";
import { AnswerCacheSection } from "./answer-cache";
import { type AgentDraft, profileErrors } from "./draft";
import { liveProfileLocked } from "./publish-state";
import a from "./agents.module.css";
import ap from "./appearance.module.css";

type Props = { agent: Agent; d: AgentDraft; onStatus: () => void; onDelete: () => void };

export function AgentSettingsTab({ agent, d, onStatus, onDelete }: Props) {
  const { slug: team, isManager } = useTeam();
  const p = d.draft.profile;
  const set = d.setProfile;
  const errors = profileErrors(p);
  const active = agent.status === "active";
  const managersOnly = isManager ? undefined : "Only team admins and owners can do this.";
  const locked = liveProfileLocked(agent, isManager);
  return (
    <div className={a.stack}>
      {/* These fields aren't versioned: "Live" only for an agent people can chat with (published). */}
      <p className={ap.liveNote}>
        {agent.published ? (
          <>
            <Badge tone="info">Live</Badge> These settings aren't part of versions: saved changes reach people at once, without publishing.
          </>
        ) : (
          "These settings aren't part of versions. Nobody can chat with this agent until it's published; from then on, saved changes reach people at once."
        )}
      </p>
      <SettingsSection title="General">
        {locked && <Alert tone="info">{locked}</Alert>}
        <Field label="Name" error={errors.name}>
          <Input id="agent-field-name" maxLength={80} disabled={Boolean(locked)} value={p.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Address" description={`Chat link: /a/${team}/${p.slug || "…"}. Changing it breaks links people saved.`} error={errors.slug}>
          <Input id="agent-field-slug" maxLength={63} spellCheck={false} disabled={Boolean(locked)} value={p.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase() })} />
        </Field>
        <Field label="Description" labelHint="Optional" description="Shown in Discover agents.">
          <Textarea id="agent-field-description" rows={2} maxLength={500} disabled={Boolean(locked)} value={p.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
      </SettingsSection>
      <AnswerCacheSection team={team} agentId={agent.id} />
      <DangerZone>
        <DangerAction
          title={active ? "Disable this agent" : "Enable this agent"}
          description={active ? "Nobody can chat with it until it's enabled again. Conversations and versions are kept." : "People who can use it can chat with it again."}
          disabledReason={agent.status === "disabled_by_platform" ? "A platform admin turned it off; only a platform admin can enable it." : managersOnly}
          action={
            <Button variant="secondary" disabled={!isManager || agent.status === "disabled_by_platform"} onClick={onStatus}>
              {active ? "Disable agent" : "Enable agent"}
            </Button>
          }
        />
        <DangerAction
          title="Delete this agent"
          description="Nobody can chat with it any more. People keep read-only access to their own conversations with it."
          disabledReason={managersOnly}
          action={
            <Button variant="danger" disabled={!isManager} onClick={onDelete}>
              Delete agent
            </Button>
          }
        />
      </DangerZone>
    </div>
  );
}
