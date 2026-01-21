import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Agent } from "../lib/api";
import { Plus, MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { AgentCard, AgentDetailPanel } from "@/components/agents";

interface AgentsProps {
  onSelectAgent: (id: string) => void;
  onOpenTestSuites: (id: string) => void;
}

export function Agents({ onSelectAgent, onOpenTestSuites }: AgentsProps) {
  const queryClient = useQueryClient();
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [isCreateMode, setIsCreateMode] = useState(false);
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

  const handleOpenPanel = (agent: Agent | null, create: boolean = false) => {
    setSelectedAgent(agent);
    setIsCreateMode(create);
  };

  const handleClosePanel = () => {
    setSelectedAgent(null);
    setIsCreateMode(false);
  };

  const handleChat = (agent: Agent) => {
    onSelectAgent(agent.id);
  };

  const handleTestSuites = (agent: Agent) => {
    onOpenTestSuites(agent.id);
  };

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
          <Button onClick={() => handleOpenPanel(null, true)}>
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
            onClick: () => handleOpenPanel(null, true),
          }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents?.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onSelect={(a) => handleOpenPanel(a, false)}
              onChat={handleChat}
              onTestSuites={handleTestSuites}
              onDelete={setAgentToDelete}
            />
          ))}
        </div>
      )}

      {/* Agent Detail Panel (Slide-out) */}
      <AgentDetailPanel
        agent={selectedAgent}
        open={!!selectedAgent || isCreateMode}
        onOpenChange={(open) => {
          if (!open) handleClosePanel();
        }}
        knowledgeBases={knowledgeBases || []}
        llmModels={llmModels || []}
        onOpenTestChat={onSelectAgent}
        isCreateMode={isCreateMode}
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
