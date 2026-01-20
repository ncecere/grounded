import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type KnowledgeBase } from "../lib/api";
import { Plus, BookOpen } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { KBCard, KBDetailPanel } from "@/components/knowledge-bases";

interface KnowledgeBasesProps {
  onSelectKb: (id: string, isShared?: boolean) => void;
}

export function KnowledgeBases({ onSelectKb }: KnowledgeBasesProps) {
  const queryClient = useQueryClient();
  const [selectedKb, setSelectedKb] = useState<KnowledgeBase | null>(null);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [kbToDelete, setKbToDelete] = useState<KnowledgeBase | null>(null);

  const { data: knowledgeBases, isLoading } = useQuery({
    queryKey: ["knowledge-bases"],
    queryFn: api.listKnowledgeBases,
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteKnowledgeBase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      setKbToDelete(null);
    },
  });

  const handleOpenPanel = (kb: KnowledgeBase | null, create: boolean = false) => {
    setSelectedKb(kb);
    setIsCreateMode(create);
  };

  const handleClosePanel = () => {
    setSelectedKb(null);
    setIsCreateMode(false);
  };

  const handleOpenKb = (kb: KnowledgeBase) => {
    onSelectKb(kb.id, kb.isShared);
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
        title="Knowledge Bases"
        description="Manage your knowledge bases and their sources"
        actions={
          <Button onClick={() => handleOpenPanel(null, true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Knowledge Base
          </Button>
        }
      />

      {knowledgeBases && knowledgeBases.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No knowledge bases yet"
          description="Get started by creating your first knowledge base"
          action={{
            label: "Create Knowledge Base",
            onClick: () => handleOpenPanel(null, true),
          }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {knowledgeBases?.map((kb) => (
            <KBCard
              key={kb.id}
              kb={kb}
              onOpen={handleOpenKb}
              onConfigure={(k) => handleOpenPanel(k, false)}
              onDelete={setKbToDelete}
            />
          ))}
        </div>
      )}

      {/* KB Detail Panel (Slide-out) */}
      <KBDetailPanel
        kb={selectedKb}
        open={!!selectedKb || isCreateMode}
        onOpenChange={(open) => {
          if (!open) handleClosePanel();
        }}
        isCreateMode={isCreateMode}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!kbToDelete}
        onOpenChange={(open) => {
          if (!open) setKbToDelete(null);
        }}
        title="Delete Knowledge Base"
        description={`Are you sure you want to delete "${kbToDelete?.name}"? This will remove all sources and content. This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (kbToDelete) {
            deleteMutation.mutate(kbToDelete.id);
          }
        }}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
