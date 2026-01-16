import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  Brain, 
  Wrench, 
  Zap, 
  Plus, 
  Trash2, 
  Loader2,
  ChevronDown,
  ChevronRight,
  Route,
  Calculator,
  Clock,
  Globe,
  Info,
} from "lucide-react";
import { api } from "../../lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import type { Agent } from "./types";

interface AgentCapabilitiesModalProps {
  agent: Agent | null;
  onClose: () => void;
}

const BUILTIN_TOOL_ICONS: Record<string, typeof Brain> = {
  multi_kb_router: Route,
  calculator: Calculator,
  date_time: Clock,
  web_search: Globe,
};

export function AgentCapabilitiesModal({ agent, onClose }: AgentCapabilitiesModalProps) {
  const queryClient = useQueryClient();
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [selectedToolId, setSelectedToolId] = useState<string>("");

  // Fetch agent capabilities
  const { data: capabilitiesData, isLoading: capabilitiesLoading } = useQuery({
    queryKey: ["agent-capabilities", agent?.id],
    queryFn: () => api.getAgentCapabilities(agent!.id),
    enabled: !!agent,
  });

  // Fetch attached tools for this agent
  const { data: agentToolsData, isLoading: toolsLoading } = useQuery({
    queryKey: ["agent-tools", agent?.id],
    queryFn: () => api.listAgentTools(agent!.id),
    enabled: !!agent,
  });

  // Fetch all available tools for this tenant
  const { data: allToolsData } = useQuery({
    queryKey: ["tools"],
    queryFn: api.listTools,
    enabled: !!agent,
  });

  // Fetch builtin tools
  const { data: builtinToolsData } = useQuery({
    queryKey: ["builtin-tools"],
    queryFn: api.listBuiltinTools,
    enabled: !!agent,
  });

  const capabilities = capabilitiesData?.capabilities;
  const agentTools = agentToolsData?.tools || [];
  const availableTools = allToolsData?.tools || [];
  const builtinTools = builtinToolsData?.tools || [];

  // Filter out already attached tools
  const attachedToolIds = new Set(agentTools.map((t) => t.toolId));
  const unattachedTools = availableTools.filter((t) => !attachedToolIds.has(t.id));

  // Update capabilities mutation
  const updateCapabilitiesMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.updateAgentCapabilities>[1]) =>
      api.updateAgentCapabilities(agent!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-capabilities", agent?.id] });
    },
  });

  // Attach tool mutation
  const attachToolMutation = useMutation({
    mutationFn: (toolId: string) =>
      api.attachToolToAgent(agent!.id, { toolId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-tools", agent?.id] });
      setSelectedToolId("");
    },
  });

  // Detach tool mutation
  const detachToolMutation = useMutation({
    mutationFn: (toolId: string) =>
      api.detachToolFromAgent(agent!.id, toolId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-tools", agent?.id] });
    },
  });

  if (!agent) return null;

  const isLoading = capabilitiesLoading || toolsLoading;

  return (
    <Dialog open={!!agent} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            Agent Capabilities
          </DialogTitle>
          <DialogDescription>
            Configure agentic features and tools for {agent.name}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Agentic Mode Section */}
            <Collapsible open={capabilitiesOpen} onOpenChange={setCapabilitiesOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-left group">
                <div className="flex items-center gap-2">
                  {capabilitiesOpen ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                  <Zap className="w-4 h-4 text-amber-500" />
                  <span className="font-medium">Agentic Capabilities</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  capabilities?.agenticModeEnabled 
                    ? "bg-primary/10 text-primary" 
                    : "bg-muted text-muted-foreground"
                }`}>
                  {capabilities?.agenticModeEnabled ? "Enabled" : "Disabled"}
                </span>
              </CollapsibleTrigger>
              
              <CollapsibleContent className="pt-4 space-y-4 pl-6">
                {/* Master Toggle */}
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div>
                    <Label className="font-medium">Agentic Mode</Label>
                    <p className="text-xs text-muted-foreground">
                      Enable advanced reasoning and tool usage
                    </p>
                  </div>
                  <Switch
                    checked={capabilities?.agenticModeEnabled ?? false}
                    onCheckedChange={(checked) =>
                      updateCapabilitiesMutation.mutate({ agenticModeEnabled: checked })
                    }
                    disabled={updateCapabilitiesMutation.isPending}
                  />
                </div>

                {/* Sub-capabilities (only show when agentic mode enabled) */}
                {capabilities?.agenticModeEnabled && (
                  <div className="space-y-3 border-l-2 border-border pl-4">
                    {/* Multi-KB Routing */}
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-2">
                        <Route className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <Label>Multi-KB Routing</Label>
                          <p className="text-xs text-muted-foreground">
                            Intelligently route queries to the best knowledge base
                          </p>
                        </div>
                      </div>
                      <Switch
                        checked={capabilities?.multiKbRoutingEnabled ?? false}
                        onCheckedChange={(checked) =>
                          updateCapabilitiesMutation.mutate({ multiKbRoutingEnabled: checked })
                        }
                        disabled={updateCapabilitiesMutation.isPending}
                      />
                    </div>

                    {/* Tool Calling */}
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-2">
                        <Wrench className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <Label>Tool Calling</Label>
                          <p className="text-xs text-muted-foreground">
                            Allow agent to use attached tools
                          </p>
                        </div>
                      </div>
                      <Switch
                        checked={capabilities?.toolCallingEnabled ?? false}
                        onCheckedChange={(checked) =>
                          updateCapabilitiesMutation.mutate({ toolCallingEnabled: checked })
                        }
                        disabled={updateCapabilitiesMutation.isPending}
                      />
                    </div>

                    {capabilities?.toolCallingEnabled && (
                      <div className="pl-6 space-y-2">
                        <Label className="text-xs">Max Tool Calls per Turn</Label>
                        <Select
                          value={String(capabilities?.maxToolCallsPerTurn || 5)}
                          onValueChange={(value) =>
                            updateCapabilitiesMutation.mutate({ maxToolCallsPerTurn: parseInt(value) })
                          }
                          disabled={updateCapabilitiesMutation.isPending}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1</SelectItem>
                            <SelectItem value="3">3</SelectItem>
                            <SelectItem value="5">5</SelectItem>
                            <SelectItem value="10">10</SelectItem>
                            <SelectItem value="20">20</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Multi-step Reasoning */}
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-2">
                        <Brain className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <Label>Multi-step Reasoning</Label>
                          <p className="text-xs text-muted-foreground">
                            Break down complex queries into steps
                          </p>
                        </div>
                      </div>
                      <Switch
                        checked={capabilities?.multiStepReasoningEnabled ?? false}
                        onCheckedChange={(checked) =>
                          updateCapabilitiesMutation.mutate({ multiStepReasoningEnabled: checked })
                        }
                        disabled={updateCapabilitiesMutation.isPending}
                      />
                    </div>

                    {capabilities?.multiStepReasoningEnabled && (
                      <div className="pl-6 space-y-2">
                        <Label className="text-xs">Max Reasoning Steps</Label>
                        <Select
                          value={String(capabilities?.maxReasoningSteps || 3)}
                          onValueChange={(value) =>
                            updateCapabilitiesMutation.mutate({ maxReasoningSteps: parseInt(value) })
                          }
                          disabled={updateCapabilitiesMutation.isPending}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="2">2</SelectItem>
                            <SelectItem value="3">3</SelectItem>
                            <SelectItem value="5">5</SelectItem>
                            <SelectItem value="10">10</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Show Chain of Thought */}
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-2">
                        <Info className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <Label>Show Chain of Thought</Label>
                          <p className="text-xs text-muted-foreground">
                            Display reasoning steps in the chat UI
                          </p>
                        </div>
                      </div>
                      <Switch
                        checked={capabilities?.showChainOfThought ?? false}
                        onCheckedChange={(checked) =>
                          updateCapabilitiesMutation.mutate({ showChainOfThought: checked })
                        }
                        disabled={updateCapabilitiesMutation.isPending}
                      />
                    </div>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>

            {/* Tools Section */}
            <Collapsible open={toolsOpen} onOpenChange={setToolsOpen}>
              <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-left group">
                <div className="flex items-center gap-2">
                  {toolsOpen ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                  <Wrench className="w-4 h-4 text-blue-500" />
                  <span className="font-medium">Attached Tools</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {agentTools.length} tool{agentTools.length !== 1 ? "s" : ""}
                </span>
              </CollapsibleTrigger>

              <CollapsibleContent className="pt-4 space-y-4 pl-6">
                {/* Attach Tool UI */}
                {unattachedTools.length > 0 && (
                  <div className="flex gap-2">
                    <Select value={selectedToolId} onValueChange={setSelectedToolId}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select a tool to attach..." />
                      </SelectTrigger>
                      <SelectContent>
                        {unattachedTools.map((tool) => (
                          <SelectItem key={tool.id} value={tool.id}>
                            <div className="flex items-center gap-2">
                              <span className="text-xs px-1.5 py-0.5 rounded bg-muted capitalize">
                                {tool.type}
                              </span>
                              {tool.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      onClick={() => selectedToolId && attachToolMutation.mutate(selectedToolId)}
                      disabled={!selectedToolId || attachToolMutation.isPending}
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Attach
                    </Button>
                  </div>
                )}

                {/* Attached Tools List */}
                {agentTools.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <Wrench className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No tools attached yet</p>
                    <p className="text-xs">
                      {availableTools.length === 0 
                        ? "Create tools first in the Tools section" 
                        : "Select a tool above to attach it"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {agentTools.map((agentTool) => {
                      const ToolIcon = BUILTIN_TOOL_ICONS[agentTool.tool.type] || Wrench;
                      return (
                        <div
                          key={agentTool.id}
                          className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border"
                        >
                          <div className="flex items-center gap-3">
                            <ToolIcon className="w-4 h-4 text-muted-foreground" />
                            <div>
                              <p className="font-medium text-sm">{agentTool.tool.name}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs px-1.5 py-0.5 rounded bg-muted capitalize">
                                  {agentTool.tool.type}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {agentTool.tool.description}
                                </span>
                              </div>
                            </div>
                          </div>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => detachToolMutation.mutate(agentTool.toolId)}
                                  disabled={detachToolMutation.isPending}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Detach tool</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Builtin Tools Info */}
                {builtinTools.length > 0 && (
                  <div className="pt-4 border-t border-border">
                    <p className="text-xs text-muted-foreground mb-2">
                      Available Built-in Tools (create from Tools page):
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {builtinTools.map((tool) => {
                        const ToolIcon = BUILTIN_TOOL_ICONS[tool.configSchema.toolType] || Wrench;
                        return (
                          <TooltipProvider key={tool.id}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-1.5 px-2 py-1 bg-muted rounded text-xs">
                                  <ToolIcon className="w-3 h-3" />
                                  {tool.name}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>{tool.description}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
