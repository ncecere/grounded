import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Share2 } from "lucide-react";
import { api } from "../../lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import type { AgentFormData, KnowledgeBase, LLMModel } from "./types";
import { defaultAgentForm } from "./types";

interface CreateAgentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  knowledgeBases: KnowledgeBase[];
  llmModels: LLMModel[];
}

export function CreateAgentModal({
  open,
  onOpenChange,
  knowledgeBases,
  llmModels,
}: CreateAgentModalProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<AgentFormData>(defaultAgentForm);

  const createMutation = useMutation({
    mutationFn: api.createAgent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      onOpenChange(false);
      setFormData(defaultAgentForm);
    },
  });

  const toggleKb = (kbId: string) => {
    setFormData((prev) => ({
      ...prev,
      kbIds: prev.kbIds.includes(kbId)
        ? prev.kbIds.filter((id) => id !== kbId)
        : [...prev.kbIds, kbId],
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || formData.kbIds.length === 0) return;
    createMutation.mutate({
      name: formData.name.trim(),
      description: formData.description.trim() || undefined,
      systemPrompt: formData.systemPrompt,
      welcomeMessage: formData.welcomeMessage || undefined,
      kbIds: formData.kbIds,
      llmModelConfigId: formData.llmModelConfigId || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Agent</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Support Agent"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Input
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Helps users with product questions"
            />
          </div>

          <div className="space-y-2">
            <Label>System Prompt</Label>
            <Textarea
              value={formData.systemPrompt}
              onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
              rows={4}
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Welcome Message</Label>
            <Input
              value={formData.welcomeMessage}
              onChange={(e) => setFormData({ ...formData, welcomeMessage: e.target.value })}
              placeholder="Hello! How can I help you today?"
            />
          </div>

          <div className="space-y-2">
            <Label>LLM Model</Label>
            {llmModels.length > 0 ? (
              <Select
                value={formData.llmModelConfigId || "default"}
                onValueChange={(value) =>
                  setFormData({ ...formData, llmModelConfigId: value === "default" ? "" : value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select LLM model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Use default model</SelectItem>
                  {llmModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.displayName} ({model.providerName})
                      {model.isDefault && " ★"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                No LLM models configured. Add models in AI Models settings.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Knowledge Bases</Label>
            {knowledgeBases.length > 0 ? (
              <div className="space-y-2 max-h-40 overflow-y-auto border border-border rounded-lg p-2">
                {knowledgeBases.map((kb) => (
                  <label
                    key={kb.id}
                    className={`flex items-center gap-2 p-2 hover:bg-muted/50 rounded cursor-pointer ${
                      kb.isShared ? "bg-purple-500/10" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={formData.kbIds.includes(kb.id)}
                      onChange={() => toggleKb(kb.id)}
                      className="rounded border-input text-primary focus:ring-primary"
                    />
                    <span className="text-sm text-foreground flex items-center gap-2">
                      {kb.name}
                      {kb.isShared && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium bg-purple-500/15 text-purple-600 dark:text-purple-400 rounded">
                          <Share2 className="w-3 h-3" />
                          Shared
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No knowledge bases available. Create one first.
              </p>
            )}
          </div>

          {createMutation.error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">{createMutation.error.message}</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || formData.kbIds.length === 0}
            >
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
