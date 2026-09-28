/* Admin → Agents: one agent in a RecordSheet (metadata, short name, kill switch, access log link). */
import { Link } from "@tanstack/react-router";
import { Power, PowerOff, ScrollText } from "lucide-react";
import type { Schemas } from "@/api/client";
import { RelativeTime } from "@/components/templates/list-page";
import { RecordSheet } from "@/components/templates/record-sheet";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { TextLink } from "@/components/ui/text-link/text-link";
import { audienceLabels } from "@/lib/terms";
import s from "../../shared.module.css";
import { ClassificationBadge, type useClassificationLevels } from "../../team/common";
import { agentStatusLabels, agentStatusTone } from "./agents";
import { ShortNameForm } from "./short-name";

type AdminAgent = Schemas["AdminAgent"];

type Props = {
  agent: AdminAgent | undefined;
  open: boolean;
  loading: boolean;
  onClose: () => void;
  isAdmin: boolean;
  levels: ReturnType<typeof useClassificationLevels>["data"];
  onKillSwitch: (a: AdminAgent) => void;
};

export function AgentSheet({ agent, open, loading, onClose, isAdmin, levels, onKillSwitch }: Props) {
  const disabled = agent?.status === "disabled_by_platform";
  return (
    <RecordSheet
      open={open}
      onClose={onClose}
      title={agent?.name ?? "Agent"}
      description="An agent's metadata. Its conversations stay private to the people who had them."
      loading={loading && !agent}
      error={!loading && open && !agent ? new Error("This agent no longer exists.") : undefined}
      facts={
        agent
          ? [
              { label: "Team", value: <TextLink render={<Link to="/admin/teams/$team" params={{ team: agent.teamSlug }} />}>{agent.teamName}</TextLink> },
              { label: "Status", value: <StatusBadge tone={agentStatusTone[agent.status]}>{agentStatusLabels[agent.status]}</StatusBadge> },
              { label: "Disabled because", value: agent.disabledReason || undefined },
              { label: "Audience", value: audienceLabels[agent.audience] },
              { label: "Classification", value: agent.classification ? <ClassificationBadge levels={levels} value={agent.classification} /> : "Not published" },
              {
                label: "Published version",
                value: agent.publishedVersion ? (
                  <>
                    v{agent.publishedVersion} · <RelativeTime value={agent.publishedAt} />
                  </>
                ) : (
                  "Not published"
                ),
              },
              { label: "Chat model", value: agent.chatModelName ?? "—" },
              { label: "Slug", value: <code className={s.mono}>{agent.slug}</code> },
              { label: "Updated", value: <RelativeTime value={agent.updatedAt} /> },
            ].filter((f) => f.value !== undefined)
          : []
      }
      sections={
        agent
          ? [
              {
                title: "Short name",
                content: isAdmin ? (
                  <ShortNameForm key={agent.id} agent={agent} />
                ) : (
                  <p className={s.settingDescription}>{agent.shortName ? <code className={s.mono}>/a/{agent.shortName}</code> : "No short name."}</p>
                ),
              },
            ]
          : []
      }
      footer={
        agent && (
          <>
            <Button variant="secondary" render={<Link to="/admin/logs" search={{ tab: "access", agent: agent.id } as never} />}>
              <ScrollText aria-hidden /> Access log
            </Button>
            {isAdmin && (
              <Button variant={disabled ? "primary" : "danger"} onClick={() => onKillSwitch(agent)}>
                {disabled ? <Power aria-hidden /> : <PowerOff aria-hidden />} {disabled ? "Enable agent" : "Disable agent…"}
              </Button>
            )}
          </>
        )
      }
    />
  );
}
