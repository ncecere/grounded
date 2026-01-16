import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Agent } from "../lib/api";
import { Plus, MessageSquare, Settings, Trash2, Pencil } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  CreateAgentModal,
  EditAgentModal,
  WidgetConfigModal,
  ChatEndpointsModal,
} from "@/components/agents";

interface AgentsProps {
  onSelectAgent: (id: string) => void;
}

export function Agents({ onSelectAgent }: AgentsProps) {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [configAgent, setConfigAgent] = useState<Agent | null>(null);
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null);

  const { data: agents, isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: api.listAgents,
  });

  const { data: knowledgeBases } = useQuery({
    queryKey: ["knowledge-bases"],
    queryFn: api.listKnowledgeBases,
  });

  const { data: llmModels } = useQuery({
    queryKey: ["llm-models"],
    queryFn: api.listLLMModels,
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteAgent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      setAgentToDelete(null);
    },
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingSkeleton variant="card" count={6} />
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Agents"
        description="Create and manage chat agents for your knowledge bases"
        actions={
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Agent
          </Button>
        }
      />

      {agents && agents.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No agents yet"
          description="Create an agent to start chatting with your knowledge bases"
          action={{
            label: "Create Agent",
            onClick: () => setShowCreateModal(true),
          }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents?.map((agent) => (
            <div
              key={agent.id}
              className={`bg-card rounded-lg border p-5 hover:shadow-sm transition-all ${
                agent.isEnabled !== false
                  ? "border-border hover:border-primary/50"
                  : "border-border opacity-60"
              }`}
            >
              <div className="cursor-pointer" onClick={() => setEditingAgent(agent)}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
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
                        <h3 className="text-lg font-semibold text-foreground hover:text-primary transition-colors truncate">
                          {agent.name}
                        </h3>
                        {agent.isEnabled === false && (
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
                  <Pencil className="w-4 h-4 text-muted-foreground ml-2 shrink-0" />
                </div>
                <div className="mt-3 text-sm text-muted-foreground">
                  <p>{agent.kbIds.length} knowledge base(s)</p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1 bg-primary/10 text-primary hover:bg-primary/20"
                  onClick={() => setChatAgent(agent)}
                  disabled={agent.isEnabled === false}
                >
                  Chat
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfigAgent(agent)}
                >
                  <Settings className="w-4 h-4 mr-1" />
                  Widget
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => setAgentToDelete(agent)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Agent Modal */}
      <CreateAgentModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        knowledgeBases={knowledgeBases || []}
        llmModels={llmModels || []}
      />

      {/* Edit Agent Modal */}
      <EditAgentModal
        agent={editingAgent}
        onClose={() => setEditingAgent(null)}
        knowledgeBases={knowledgeBases || []}
        llmModels={llmModels || []}
      />

      {/* Widget Config Modal */}
      <WidgetConfigModal agent={configAgent} onClose={() => setConfigAgent(null)} />

      {/* Chat Endpoints Modal */}
      <ChatEndpointsModal
        agent={chatAgent}
        onClose={() => setChatAgent(null)}
        onOpenTestChat={onSelectAgent}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!agentToDelete}
        onOpenChange={(open) => {
          if (!open) setAgentToDelete(null);
        }}
        title="Delete Agent"
        description={`Are you sure you want to delete "${agentToDelete?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (agentToDelete) {
            deleteMutation.mutate(agentToDelete.id);
          }
        }}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
