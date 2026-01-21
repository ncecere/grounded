import { MessageSquare, Settings, Trash2, ExternalLink, FlaskConical } from "lucide-react";
import { Button } from "../ui/button";
import type { Agent } from "../../lib/api";

interface AgentCardProps {
  agent: Agent;
  onSelect: (agent: Agent) => void;
  onChat: (agent: Agent) => void;
  onTestSuites: (agent: Agent) => void;
  onDelete: (agent: Agent) => void;
}

export function AgentCard({ agent, onSelect, onChat, onTestSuites, onDelete }: AgentCardProps) {
  const isDisabled = agent.isEnabled === false;

  return (
    <div
      className={`group relative bg-card rounded-lg border p-5 transition-all cursor-pointer ${
        isDisabled
          ? "border-border opacity-60"
          : "border-border hover:border-primary/50 hover:shadow-md"
      }`}
      onClick={() => onSelect(agent)}
    >
      {/* Main content */}
      <div className="flex items-start gap-3">
        {agent.logoUrl && (
          <img
            src={agent.logoUrl}
            alt=""
            className="w-10 h-10 rounded-lg object-cover shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-foreground truncate">
              {agent.name}
            </h3>
            {isDisabled && (
              <span className="px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground rounded-full shrink-0">
                Disabled
              </span>
            )}
          </div>
          {agent.description && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {agent.description}
            </p>
          )}
        </div>
      </div>

      {/* Metadata */}
      <div className="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
        <span>{agent.kbIds.length} knowledge base{agent.kbIds.length !== 1 ? "s" : ""}</span>
        {agent.ragType === "advanced" && (
          <span className="px-1.5 py-0.5 text-xs bg-blue-500/15 text-blue-600 dark:text-blue-400 rounded">
            Advanced
          </span>
        )}
      </div>

      {/* Hover overlay with actions */}
      <div
        className={`absolute inset-0 rounded-lg bg-background/95 backdrop-blur-sm flex flex-wrap items-center justify-center gap-2 transition-opacity ${
          isDisabled
            ? "opacity-0 pointer-events-none"
            : "opacity-0 group-hover:opacity-100"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          variant="default"
          size="sm"
          onClick={() => onChat(agent)}
          className="gap-1.5"
        >
          <MessageSquare className="w-4 h-4" />
          Chat
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onSelect(agent)}
          className="gap-1.5"
        >
          <Settings className="w-4 h-4" />
          Configure
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onTestSuites(agent)}
          className="gap-1.5"
        >
          <FlaskConical className="w-4 h-4" />
          Test Suites
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(agent)}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      {/* Click hint (shown on non-hover) */}
      <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-0 transition-opacity pointer-events-none">
        <ExternalLink className="w-4 h-4 text-muted-foreground" />
      </div>
    </div>
  );
}
