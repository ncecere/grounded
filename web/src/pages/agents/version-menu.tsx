/*
 * The agent editor's version badge as a menu (I6, docs/v0.2.1.md): "v4 live"
 * ("v4" while the agent is disabled, "Draft" before the first publish) opens
 * Version history, Compare versions and "Revert draft to v4…", disabled with
 * the reason while the draft already matches v4, so it can be found. It
 * replaces the Versions tab and says the agent is live, so the header has
 * no separate Live badge; Publish stays the header's primary.
 */
import { ChevronDown, GitCompareArrows, History, RotateCcw } from "lucide-react";
import { ItemText } from "@/components/templates/action-menu";
import { Button } from "@/components/ui/button/button";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu/menu";
import type { Agent } from "./common";
import type { HistoryView } from "./version-history";
import a from "./agents.module.css";

/** Why reverting the draft to a version does nothing, or undefined when it would change the draft. */
export const revertReason = (agent: Pick<Agent, "published" | "hasUnpublishedChanges">, version: number) =>
  agent.published?.version === version && !agent.hasUnpublishedChanges ? `The draft already matches v${version}` : undefined;

export function VersionMenu({ agent, onOpen, onRevert }: { agent: Agent; onOpen: (view: HistoryView) => void; onRevert: (version: number) => void }) {
  const live = agent.published?.version;
  const reason = live === undefined ? undefined : revertReason(agent, live);
  const label = `Revert draft to v${live}…`;
  return (
    <Menu
      trigger={
        <Button variant="secondary" size="sm" className={a.versionMenu}>
          {live === undefined ? "Draft" : agent.status === "active" ? `v${live} live` : `v${live}`}
          <ChevronDown aria-hidden />
        </Button>
      }
    >
      <MenuItem icon={<History aria-hidden />} onClick={() => onOpen("versions")}>
        Version history
      </MenuItem>
      {live !== undefined && (
        <>
          <MenuItem icon={<GitCompareArrows aria-hidden />} onClick={() => onOpen("compare")}>
            Compare versions
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<RotateCcw aria-hidden />} disabled={Boolean(reason)} onClick={() => onRevert(live)}>
            {reason ? <ItemText label={label} reason={reason} /> : label}
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
