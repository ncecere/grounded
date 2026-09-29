/*
 * The agent editor's version badge as a menu (I6, docs/v0.2.1.md): "v4 live"
 * (or "Draft" before the first publish) opens Version history, Compare
 * versions and, when the draft has unpublished changes, "Revert draft to
 * v4…". It replaces the Versions tab; Publish stays the header's primary.
 */
import { ChevronDown, GitCompareArrows, History, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button/button";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu/menu";
import type { Agent } from "./common";
import type { HistoryView } from "./version-history";
import a from "./agents.module.css";

export function VersionMenu({ agent, onOpen, onRevert }: { agent: Agent; onOpen: (view: HistoryView) => void; onRevert: (version: number) => void }) {
  const live = agent.published?.version;
  return (
    <Menu
      trigger={
        <Button variant="secondary" size="sm" className={a.versionMenu}>
          {live ? `v${live} live` : "Draft"}
          <ChevronDown aria-hidden />
        </Button>
      }
    >
      <MenuItem icon={<History aria-hidden />} onClick={() => onOpen("versions")}>
        Version history
      </MenuItem>
      {live !== undefined && (
        <MenuItem icon={<GitCompareArrows aria-hidden />} onClick={() => onOpen("compare")}>
          Compare versions
        </MenuItem>
      )}
      {live !== undefined && agent.hasUnpublishedChanges && (
        <>
          <MenuSeparator />
          <MenuItem icon={<RotateCcw aria-hidden />} onClick={() => onRevert(live)}>
            Revert draft to v{live}…
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
