import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type ModelProvider,
  type ModelConfiguration,
  type ProviderType,
  type ModelType,
} from "../lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoBox } from "@/components/ui/info-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Server, Cpu, Activity, Info } from "lucide-react";

type ModelsTab = "providers" | "models" | "status";

const PROVIDER_TYPES: { value: ProviderType; label: string }[] = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google AI" },
  { value: "openai-compatible", label: "OpenAI Compatible" },
];

const MODEL_TYPES: { value: ModelType; label: string }[] = [
  { value: "chat", label: "Chat / LLM" },
  { value: "embedding", label: "Embedding" },
];

// Provider Form Dialog
function ProviderFormDialog({
  provider,
  open,
  onOpenChange,
  onSave,
  isSaving,
}: {
  provider?: ModelProvider;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: {
    name: string;
    displayName: string;
    type: ProviderType;
    baseUrl: string | null;
    apiKey: string;
    isEnabled: boolean;
  }) => void;
  isSaving: boolean;
}) {
  const [formData, setFormData] = useState({
    name: provider?.name || "",
    displayName: provider?.displayName || "",
    type: provider?.type || ("openai" as ProviderType),
    baseUrl: provider?.baseUrl || "",
    apiKey: "",
    isEnabled: provider?.isEnabled ?? true,
  });

  // Reset form data when dialog opens or provider changes
  useEffect(() => {
    if (open) {
      setFormData({
        name: provider?.name || "",
        displayName: provider?.displayName || "",
        type: provider?.type || ("openai" as ProviderType),
        baseUrl: provider?.baseUrl || "",
        apiKey: "", // Always empty for security
        isEnabled: provider?.isEnabled ?? true,
      });
    }
  }, [open, provider]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      baseUrl: formData.baseUrl || null,
    });
  };

  const showBaseUrl = formData.type === "openai-compatible" || formData.type === "openai";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{provider ? "Edit Provider" : "Add Provider"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Provider Name (slug)</Label>
            <Input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
              placeholder="my-openai"
              disabled={!!provider}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Display Name</Label>
            <Input
              type="text"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              placeholder="My OpenAI Instance"
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Provider Type</Label>
            <Select
              value={formData.type}
              onValueChange={(value) => setFormData({ ...formData, type: value as ProviderType })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select provider type" />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_TYPES.map((pt) => (
                  <SelectItem key={pt.value} value={pt.value}>
                    {pt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {showBaseUrl && (
            <div className="space-y-2">
              <Label>
                Base URL {formData.type === "openai-compatible" && <span className="text-destructive">*</span>}
              </Label>
              <Input
                type="url"
                value={formData.baseUrl}
                onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                placeholder="https://api.groq.com/openai/v1"
                required={formData.type === "openai-compatible"}
              />
              <p className="text-xs text-muted-foreground">
                {formData.type === "openai" ? "Leave empty for default OpenAI API" : "Required for OpenAI-compatible providers"}
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label>
              API Key {!provider && <span className="text-destructive">*</span>}
            </Label>
            <Input
              type="password"
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              placeholder={provider ? "Enter new key to update" : "sk-..."}
              required={!provider}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="isEnabled"
              checked={formData.isEnabled}
              onCheckedChange={(checked) => setFormData({ ...formData, isEnabled: checked === true })}
            />
            <Label htmlFor="isEnabled" className="text-sm font-normal">Enabled</Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Model Form Dialog
function ModelFormDialog({
  model,
  providers,
  open,
  onOpenChange,
  onSave,
  isSaving,
}: {
  model?: ModelConfiguration;
  providers: ModelProvider[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: {
    providerId: string;
    modelId: string;
    displayName: string;
    modelType: ModelType;
    maxTokens?: number;
    temperature?: number;
    supportsStreaming?: boolean;
    supportsTools?: boolean;
    dimensions?: number | null;
    isEnabled?: boolean;
    isDefault?: boolean;
  }) => void;
  isSaving: boolean;
}) {
  const [formData, setFormData] = useState({
    providerId: model?.providerId || providers[0]?.id || "",
    modelId: model?.modelId || "",
    displayName: model?.displayName || "",
    modelType: model?.modelType || ("chat" as ModelType),
    maxTokens: model?.maxTokens || 4096,
    temperature: model?.temperature ? parseFloat(model.temperature) : 0.1,
    supportsStreaming: model?.supportsStreaming ?? true,
    supportsTools: model?.supportsTools ?? false,
    dimensions: model?.dimensions || 1536,
    isEnabled: model?.isEnabled ?? true,
    isDefault: model?.isDefault ?? false,
  });

  // Reset form data when dialog opens or model changes
  useEffect(() => {
    if (open) {
      setFormData({
        providerId: model?.providerId || providers[0]?.id || "",
        modelId: model?.modelId || "",
        displayName: model?.displayName || "",
        modelType: model?.modelType || ("chat" as ModelType),
        maxTokens: model?.maxTokens || 4096,
        temperature: model?.temperature ? parseFloat(model.temperature) : 0.1,
        supportsStreaming: model?.supportsStreaming ?? true,
        supportsTools: model?.supportsTools ?? false,
        dimensions: model?.dimensions || 1536,
        isEnabled: model?.isEnabled ?? true,
        isDefault: model?.isDefault ?? false,
      });
    }
  }, [open, model, providers]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      dimensions: formData.modelType === "embedding" ? formData.dimensions : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{model ? "Edit Model" : "Add Model"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select
              value={formData.providerId}
              onValueChange={(value) => setFormData({ ...formData, providerId: value })}
              disabled={!!model}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Model ID</Label>
            <Input
              type="text"
              value={formData.modelId}
              onChange={(e) => setFormData({ ...formData, modelId: e.target.value })}
              placeholder="gpt-4-turbo"
              disabled={!!model}
              required
            />
            <p className="text-xs text-muted-foreground">
              The exact model ID as used by the API (e.g., gpt-4-turbo, claude-3-opus-20240229)
            </p>
          </div>
          <div className="space-y-2">
            <Label>Display Name</Label>
            <Input
              type="text"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              placeholder="GPT-4 Turbo"
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Model Type</Label>
            <Select
              value={formData.modelType}
              onValueChange={(value) => setFormData({ ...formData, modelType: value as ModelType })}
              disabled={!!model}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select model type" />
              </SelectTrigger>
              <SelectContent>
                {MODEL_TYPES.map((mt) => (
                  <SelectItem key={mt.value} value={mt.value}>
                    {mt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {formData.modelType === "chat" && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Max Tokens</Label>
                  <Input
                    type="number"
                    value={formData.maxTokens}
                    onChange={(e) => setFormData({ ...formData, maxTokens: parseInt(e.target.value) || 4096 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Temperature</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={formData.temperature}
                    onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) || 0.1 })}
                  />
                </div>
              </div>
              <div className="flex gap-6">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="supportsStreaming"
                    checked={formData.supportsStreaming}
                    onCheckedChange={(checked) => setFormData({ ...formData, supportsStreaming: checked === true })}
                  />
                  <Label htmlFor="supportsStreaming" className="text-sm font-normal">
                    Supports Streaming
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="supportsTools"
                    checked={formData.supportsTools}
                    onCheckedChange={(checked) => setFormData({ ...formData, supportsTools: checked === true })}
                  />
                  <Label htmlFor="supportsTools" className="text-sm font-normal">
                    Supports Tools
                  </Label>
                </div>
              </div>
            </>
          )}

          {formData.modelType === "embedding" && (
            <div className="space-y-2">
              <Label>
                Dimensions <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                value={formData.dimensions}
                onChange={(e) => setFormData({ ...formData, dimensions: parseInt(e.target.value) || 1536 })}
                required
              />
              <p className="text-xs text-muted-foreground">
                Vector dimensions (e.g., 1536 for text-embedding-3-small)
              </p>
            </div>
          )}

          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <Checkbox
                id="modelIsEnabled"
                checked={formData.isEnabled}
                onCheckedChange={(checked) => setFormData({ ...formData, isEnabled: checked === true })}
              />
              <Label htmlFor="modelIsEnabled" className="text-sm font-normal">Enabled</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="isDefault"
                checked={formData.isDefault}
                onCheckedChange={(checked) => setFormData({ ...formData, isDefault: checked === true })}
              />
              <Label htmlFor="isDefault" className="text-sm font-normal">Set as Default</Label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Providers Tab Content
function ProvidersTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ModelProvider | undefined>();
  const [providerToDelete, setProviderToDelete] = useState<ModelProvider | null>(null);
  const [testResult, setTestResult] = useState<{ providerId: string; success: boolean; message: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-providers"],
    queryFn: () => api.listProviders(),
  });

  const createMutation = useMutation({
    mutationFn: api.createProvider,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-providers"] });
      setShowForm(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updateProvider>[1] }) =>
      api.updateProvider(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-providers"] });
      setEditingProvider(undefined);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteProvider,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-providers"] });
      setProviderToDelete(null);
    },
  });

  const testMutation = useMutation({
    mutationFn: api.testProvider,
    onSuccess: (data, providerId) => {
      setTestResult({
        providerId,
        success: data.success,
        message: data.success 
          ? `Test successful! Found ${data.modelsFound || 0} model(s) configured.`
          : data.message || "Test failed",
      });
      // Clear the result after 5 seconds
      setTimeout(() => setTestResult(null), 5000);
    },
    onError: (error: Error, providerId) => {
      setTestResult({
        providerId,
        success: false,
        message: error.message || "Test failed",
      });
      // Clear the result after 5 seconds
      setTimeout(() => setTestResult(null), 5000);
    },
  });

  if (isLoading) {
    return <LoadingSkeleton variant="card" count={3} />;
  }

  const providers = data?.providers || [];

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">
          Configure AI providers with their API credentials
        </p>
        <Button onClick={() => setShowForm(true)}>
          Add Provider
        </Button>
      </div>

      {providers.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No providers configured"
          description="Add a provider to start using AI models"
          action={{
            label: "Add Provider",
            onClick: () => setShowForm(true),
          }}
        />
      ) : (
        <div className="space-y-3">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="bg-card border border-border rounded-lg p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      provider.isEnabled ? "bg-success" : "bg-muted-foreground"
                    }`}
                  />
                  <div>
                    <h3 className="font-medium text-foreground">{provider.displayName}</h3>
                    <p className="text-sm text-muted-foreground">
                      {PROVIDER_TYPES.find((t) => t.value === provider.type)?.label} • {provider.name}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => testMutation.mutate(provider.id)}
                    disabled={testMutation.isPending && testMutation.variables === provider.id}
                  >
                    {testMutation.isPending && testMutation.variables === provider.id ? "Testing..." : "Test"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingProvider(provider)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setProviderToDelete(provider)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
              {/* Test result display */}
              {testResult && testResult.providerId === provider.id && (
                <div
                  className={`mt-3 p-2 rounded text-sm ${
                    testResult.success
                      ? "bg-success/10 text-success border border-success/20"
                      : "bg-destructive/10 text-destructive border border-destructive/20"
                  }`}
                >
                  {testResult.message}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ProviderFormDialog
        provider={editingProvider}
        open={showForm || !!editingProvider}
        onOpenChange={(open) => {
          if (!open) {
            setShowForm(false);
            setEditingProvider(undefined);
          }
        }}
        onSave={(data) => {
          if (editingProvider) {
            updateMutation.mutate({
              id: editingProvider.id,
              data: {
                displayName: data.displayName,
                type: data.type,
                baseUrl: data.baseUrl,
                apiKey: data.apiKey || undefined,
                isEnabled: data.isEnabled,
              },
            });
          } else {
            createMutation.mutate(data);
          }
        }}
        isSaving={createMutation.isPending || updateMutation.isPending}
      />

      <ConfirmDialog
        open={!!providerToDelete}
        onOpenChange={(open) => {
          if (!open) setProviderToDelete(null);
        }}
        title="Delete Provider"
        description={`Are you sure you want to delete "${providerToDelete?.displayName}"? This will also delete all associated models.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (providerToDelete) {
            deleteMutation.mutate(providerToDelete.id);
          }
        }}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

// Models Tab Content
function ModelsTabContent() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelConfiguration | undefined>();
  const [modelToDelete, setModelToDelete] = useState<ModelConfiguration | null>(null);
  const [filterType, setFilterType] = useState<ModelType | "">("");

  const { data: providersData } = useQuery({
    queryKey: ["admin-providers"],
    queryFn: () => api.listProviders(),
  });

  const { data: modelsData, isLoading } = useQuery({
    queryKey: ["admin-models", filterType],
    queryFn: () => api.listModels(filterType ? { type: filterType } : undefined),
  });

  const createMutation = useMutation({
    mutationFn: api.createModel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-models"] });
      setShowForm(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updateModel>[1] }) =>
      api.updateModel(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-models"] });
      setEditingModel(undefined);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteModel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-models"] });
      setModelToDelete(null);
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: api.setDefaultModel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-models"] });
    },
  });

  if (isLoading) {
    return <LoadingSkeleton variant="card" count={3} />;
  }

  const providers = providersData?.providers || [];
  const models = modelsData?.models || [];

  if (providers.length === 0) {
    return (
      <EmptyState
        icon={Server}
        title="No providers configured"
        description="Add a provider first before configuring models"
      />
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-4">
          <p className="text-sm text-muted-foreground">
            Configure models for each provider
          </p>
          <Select
            value={filterType || "all"}
            onValueChange={(value) => setFilterType(value === "all" ? "" : value as ModelType)}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {MODEL_TYPES.map((mt) => (
                <SelectItem key={mt.value} value={mt.value}>
                  {mt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => setShowForm(true)}>
          Add Model
        </Button>
      </div>

      {models.length === 0 ? (
        <EmptyState
          icon={Cpu}
          title="No models configured"
          description="Add models to use for chat and embeddings"
          action={{
            label: "Add Model",
            onClick: () => setShowForm(true),
          }}
        />
      ) : (
        <div className="space-y-3">
          {models.map((model) => (
            <div
              key={model.id}
              className="bg-card border border-border rounded-lg p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      model.isEnabled ? "bg-success" : "bg-muted-foreground"
                    }`}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-foreground">{model.displayName}</h3>
                      {model.isDefault && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-primary/15 text-primary rounded-full">
                          Default
                        </span>
                      )}
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        model.modelType === "chat"
                          ? "bg-purple-500/15 text-purple-600 dark:text-purple-400"
                          : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      }`}>
                        {model.modelType}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {model.provider?.displayName} • {model.modelId}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!model.isDefault && model.isEnabled && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDefaultMutation.mutate(model.id)}
                      disabled={setDefaultMutation.isPending}
                    >
                      Set Default
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingModel(model)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setModelToDelete(model)}
                    disabled={model.isDefault}
                  >
                    Delete
                  </Button>
                </div>
              </div>
              {model.modelType === "chat" && (
                <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
                  <span>Max Tokens: {model.maxTokens}</span>
                  <span>Temperature: {model.temperature}</span>
                  {model.supportsStreaming && <span className="text-success">Streaming</span>}
                  {model.supportsTools && <span className="text-success">Tools</span>}
                </div>
              )}
              {model.modelType === "embedding" && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Dimensions: {model.dimensions}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ModelFormDialog
        model={editingModel}
        providers={providers}
        open={showForm || !!editingModel}
        onOpenChange={(open) => {
          if (!open) {
            setShowForm(false);
            setEditingModel(undefined);
          }
        }}
        onSave={(data) => {
          if (editingModel) {
            updateMutation.mutate({
              id: editingModel.id,
              data: {
                displayName: data.displayName,
                maxTokens: data.maxTokens,
                temperature: data.temperature,
                supportsStreaming: data.supportsStreaming,
                supportsTools: data.supportsTools,
                dimensions: data.dimensions,
                isEnabled: data.isEnabled,
                isDefault: data.isDefault,
              },
            });
          } else {
            createMutation.mutate(data);
          }
        }}
        isSaving={createMutation.isPending || updateMutation.isPending}
      />

      <ConfirmDialog
        open={!!modelToDelete}
        onOpenChange={(open) => {
          if (!open) setModelToDelete(null);
        }}
        title="Delete Model"
        description={`Are you sure you want to delete "${modelToDelete?.displayName}"?`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (modelToDelete) {
            deleteMutation.mutate(modelToDelete.id);
          }
        }}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}

// Status Tab Content
function StatusTab() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-registry-status"],
    queryFn: () => api.getRegistryStatus(),
    refetchInterval: 30000,
  });

  const refreshMutation = useMutation({
    mutationFn: api.refreshRegistry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-registry-status"] });
    },
  });

  if (isLoading) {
    return <LoadingSkeleton variant="form" count={6} />;
  }

  if (error) {
    return (
      <div className="p-4 bg-destructive/10 text-destructive rounded-lg">
        Failed to load registry status
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">
          Current AI registry status
        </p>
        <Button
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
        >
          {refreshMutation.isPending ? "Refreshing..." : "Refresh Registry"}
        </Button>
      </div>

      <div className="bg-card border border-border rounded-lg divide-y divide-border">
        <div className="p-4 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Status</span>
          <StatusBadge
            status={data?.initialized ? "active" : "error"}
            label={data?.initialized ? "Initialized" : "Not Initialized"}
          />
        </div>
        <div className="p-4 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Providers</span>
          <span className="text-sm text-foreground">{data?.providerCount || 0}</span>
        </div>
        <div className="p-4 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Chat Models</span>
          <span className="text-sm text-foreground">{data?.chatModelCount || 0}</span>
        </div>
        <div className="p-4 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Embedding Models</span>
          <span className="text-sm text-foreground">{data?.embeddingModelCount || 0}</span>
        </div>
        <div className="p-4 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Default Chat Model</span>
          <span className="text-sm text-foreground">{data?.defaultChatModel || "Not set"}</span>
        </div>
        <div className="p-4 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Default Embedding Model</span>
          <span className="text-sm text-foreground">{data?.defaultEmbeddingModel || "Not set"}</span>
        </div>
        {data?.error && (
          <div className="p-4">
            <span className="text-sm font-medium text-destructive">Error: {data.error}</span>
          </div>
        )}
      </div>

      <InfoBox icon={Info} className="mt-6">
        <h3 className="text-sm font-medium">Environment Variable Fallback</h3>
        <p className="mt-1 text-sm">
          If no providers are configured in the database, the system will fall back to environment variables
          (<code className="bg-primary/10 px-1 rounded">LLM_API_KEY</code>, <code className="bg-primary/10 px-1 rounded">EMBEDDING_API_KEY</code>, etc.)
        </p>
      </InfoBox>
    </div>
  );
}

export function AdminModels() {
  const [activeTab, setActiveTab] = useState<ModelsTab>("providers");

  return (
    <div className="p-6">
      <PageHeader
        title="AI Models"
        description="Configure AI providers and models for chat and embeddings"
      />

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ModelsTab)}>
        <TabsList className="mb-6">
          <TabsTrigger value="providers" className="gap-2">
            <Server className="w-4 h-4" />
            Providers
          </TabsTrigger>
          <TabsTrigger value="models" className="gap-2">
            <Cpu className="w-4 h-4" />
            Models
          </TabsTrigger>
          <TabsTrigger value="status" className="gap-2">
            <Activity className="w-4 h-4" />
            Status
          </TabsTrigger>
        </TabsList>

        <TabsContent value="providers">
          <ProvidersTab />
        </TabsContent>
        <TabsContent value="models">
          <ModelsTabContent />
        </TabsContent>
        <TabsContent value="status">
          <StatusTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
