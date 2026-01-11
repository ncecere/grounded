import { useState } from "react";
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
  onClose,
  onSave,
  isSaving,
}: {
  provider?: ModelProvider;
  onClose: () => void;
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      baseUrl: formData.baseUrl || null,
    });
  };

  const showBaseUrl = formData.type === "openai-compatible" || formData.type === "openai";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">
            {provider ? "Edit Provider" : "Add Provider"}
          </h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Provider Name (slug)
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
              placeholder="my-openai"
              disabled={!!provider}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              placeholder="My OpenAI Instance"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Provider Type
            </label>
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Base URL {formData.type === "openai-compatible" && <span className="text-red-500">*</span>}
              </label>
              <input
                type="url"
                value={formData.baseUrl}
                onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                placeholder="https://api.groq.com/openai/v1"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                required={formData.type === "openai-compatible"}
              />
              <p className="mt-1 text-xs text-gray-500">
                {formData.type === "openai" ? "Leave empty for default OpenAI API" : "Required for OpenAI-compatible providers"}
              </p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              API Key {!provider && <span className="text-red-500">*</span>}
            </label>
            <input
              type="password"
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              placeholder={provider ? "Enter new key to update" : "sk-..."}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
              required={!provider}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isEnabled"
              checked={formData.isEnabled}
              onChange={(e) => setFormData({ ...formData, isEnabled: e.target.checked })}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="isEnabled" className="text-sm text-gray-700">
              Enabled
            </label>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Model Form Dialog
function ModelFormDialog({
  model,
  providers,
  onClose,
  onSave,
  isSaving,
}: {
  model?: ModelConfiguration;
  providers: ModelProvider[];
  onClose: () => void;
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      dimensions: formData.modelType === "embedding" ? formData.dimensions : null,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">
            {model ? "Edit Model" : "Add Model"}
          </h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Provider
            </label>
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Model ID
            </label>
            <input
              type="text"
              value={formData.modelId}
              onChange={(e) => setFormData({ ...formData, modelId: e.target.value })}
              placeholder="gpt-4-turbo"
              disabled={!!model}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100"
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              The exact model ID as used by the API (e.g., gpt-4-turbo, claude-3-opus-20240229)
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              placeholder="GPT-4 Turbo"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Model Type
            </label>
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
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Max Tokens
                  </label>
                  <input
                    type="number"
                    value={formData.maxTokens}
                    onChange={(e) => setFormData({ ...formData, maxTokens: parseInt(e.target.value) || 4096 })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Temperature
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={formData.temperature}
                    onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) || 0.1 })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="flex gap-6">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="supportsStreaming"
                    checked={formData.supportsStreaming}
                    onChange={(e) => setFormData({ ...formData, supportsStreaming: e.target.checked })}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="supportsStreaming" className="text-sm text-gray-700">
                    Supports Streaming
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="supportsTools"
                    checked={formData.supportsTools}
                    onChange={(e) => setFormData({ ...formData, supportsTools: e.target.checked })}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="supportsTools" className="text-sm text-gray-700">
                    Supports Tools
                  </label>
                </div>
              </div>
            </>
          )}

          {formData.modelType === "embedding" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Dimensions <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                value={formData.dimensions}
                onChange={(e) => setFormData({ ...formData, dimensions: parseInt(e.target.value) || 1536 })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                required
              />
              <p className="mt-1 text-xs text-gray-500">
                Vector dimensions (e.g., 1536 for text-embedding-3-small)
              </p>
            </div>
          )}

          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isEnabled"
                checked={formData.isEnabled}
                onChange={(e) => setFormData({ ...formData, isEnabled: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="isEnabled" className="text-sm text-gray-700">
                Enabled
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isDefault"
                checked={formData.isDefault}
                onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="isDefault" className="text-sm text-gray-700">
                Set as Default
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Providers Tab Content
function ProvidersTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ModelProvider | undefined>();

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
    },
  });

  const testMutation = useMutation({
    mutationFn: api.testProvider,
  });

  if (isLoading) {
    return <div className="p-4 text-gray-500">Loading providers...</div>;
  }

  const providers = data?.providers || [];

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-600">
          Configure AI providers with their API credentials
        </p>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          Add Provider
        </button>
      </div>

      {providers.length === 0 ? (
        <div className="text-center py-8 bg-gray-50 rounded-lg">
          <p className="text-gray-500">No providers configured</p>
          <p className="text-sm text-gray-400 mt-1">
            Add a provider to start using AI models
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="bg-white border rounded-lg p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-4">
                <div
                  className={`w-3 h-3 rounded-full ${
                    provider.isEnabled ? "bg-green-500" : "bg-gray-300"
                  }`}
                />
                <div>
                  <h3 className="font-medium text-gray-900">{provider.displayName}</h3>
                  <p className="text-sm text-gray-500">
                    {PROVIDER_TYPES.find((t) => t.value === provider.type)?.label} • {provider.name}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => testMutation.mutate(provider.id)}
                  disabled={testMutation.isPending}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
                >
                  {testMutation.isPending ? "Testing..." : "Test"}
                </button>
                <button
                  onClick={() => setEditingProvider(provider)}
                  className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded"
                >
                  Edit
                </button>
                <button
                  onClick={() => {
                    if (confirm("Delete this provider?")) {
                      deleteMutation.mutate(provider.id);
                    }
                  }}
                  className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(showForm || editingProvider) && (
        <ProviderFormDialog
          provider={editingProvider}
          onClose={() => {
            setShowForm(false);
            setEditingProvider(undefined);
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
      )}
    </div>
  );
}

// Models Tab Content
function ModelsTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelConfiguration | undefined>();
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
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: api.setDefaultModel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-models"] });
    },
  });

  if (isLoading) {
    return <div className="p-4 text-gray-500">Loading models...</div>;
  }

  const providers = providersData?.providers || [];
  const models = modelsData?.models || [];

  if (providers.length === 0) {
    return (
      <div className="text-center py-8 bg-gray-50 rounded-lg">
        <p className="text-gray-500">No providers configured</p>
        <p className="text-sm text-gray-400 mt-1">
          Add a provider first before configuring models
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-4">
          <p className="text-sm text-gray-600">
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
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          Add Model
        </button>
      </div>

      {models.length === 0 ? (
        <div className="text-center py-8 bg-gray-50 rounded-lg">
          <p className="text-gray-500">No models configured</p>
          <p className="text-sm text-gray-400 mt-1">
            Add models to use for chat and embeddings
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {models.map((model) => (
            <div
              key={model.id}
              className="bg-white border rounded-lg p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      model.isEnabled ? "bg-green-500" : "bg-gray-300"
                    }`}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900">{model.displayName}</h3>
                      {model.isDefault && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                          Default
                        </span>
                      )}
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        model.modelType === "chat"
                          ? "bg-purple-100 text-purple-700"
                          : "bg-amber-100 text-amber-700"
                      }`}>
                        {model.modelType}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">
                      {model.provider?.displayName} • {model.modelId}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!model.isDefault && model.isEnabled && (
                    <button
                      onClick={() => setDefaultMutation.mutate(model.id)}
                      disabled={setDefaultMutation.isPending}
                      className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
                    >
                      Set Default
                    </button>
                  )}
                  <button
                    onClick={() => setEditingModel(model)}
                    className="px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("Delete this model configuration?")) {
                        deleteMutation.mutate(model.id);
                      }
                    }}
                    disabled={model.isDefault}
                    className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {model.modelType === "chat" && (
                <div className="mt-2 flex gap-4 text-xs text-gray-500">
                  <span>Max Tokens: {model.maxTokens}</span>
                  <span>Temperature: {model.temperature}</span>
                  {model.supportsStreaming && <span className="text-green-600">Streaming</span>}
                  {model.supportsTools && <span className="text-green-600">Tools</span>}
                </div>
              )}
              {model.modelType === "embedding" && (
                <div className="mt-2 text-xs text-gray-500">
                  Dimensions: {model.dimensions}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(showForm || editingModel) && (
        <ModelFormDialog
          model={editingModel}
          providers={providers}
          onClose={() => {
            setShowForm(false);
            setEditingModel(undefined);
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
      )}
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
    return <div className="p-4 text-gray-500">Loading status...</div>;
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 text-red-700 rounded-lg">
        Failed to load registry status
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-600">
          Current AI registry status
        </p>
        <button
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {refreshMutation.isPending ? "Refreshing..." : "Refresh Registry"}
        </button>
      </div>

      <div className="bg-white border rounded-lg divide-y">
        <div className="p-4 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Status</span>
          <span className={`px-2 py-1 text-sm rounded ${
            data?.initialized
              ? "bg-green-100 text-green-700"
              : "bg-red-100 text-red-700"
          }`}>
            {data?.initialized ? "Initialized" : "Not Initialized"}
          </span>
        </div>
        <div className="p-4 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Providers</span>
          <span className="text-sm text-gray-900">{data?.providerCount || 0}</span>
        </div>
        <div className="p-4 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Chat Models</span>
          <span className="text-sm text-gray-900">{data?.chatModelCount || 0}</span>
        </div>
        <div className="p-4 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Embedding Models</span>
          <span className="text-sm text-gray-900">{data?.embeddingModelCount || 0}</span>
        </div>
        <div className="p-4 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Default Chat Model</span>
          <span className="text-sm text-gray-900">{data?.defaultChatModel || "Not set"}</span>
        </div>
        <div className="p-4 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Default Embedding Model</span>
          <span className="text-sm text-gray-900">{data?.defaultEmbeddingModel || "Not set"}</span>
        </div>
        {data?.error && (
          <div className="p-4">
            <span className="text-sm font-medium text-red-700">Error: {data.error}</span>
          </div>
        )}
      </div>

      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <svg className="w-5 h-5 text-blue-400 mr-3 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <h3 className="text-sm font-medium text-blue-800">Environment Variable Fallback</h3>
            <p className="mt-1 text-sm text-blue-700">
              If no providers are configured in the database, the system will fall back to environment variables
              (<code className="bg-blue-100 px-1 rounded">LLM_API_KEY</code>, <code className="bg-blue-100 px-1 rounded">EMBEDDING_API_KEY</code>, etc.)
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdminModels() {
  const [activeTab, setActiveTab] = useState<ModelsTab>("providers");

  const tabs: Array<{ id: ModelsTab; label: string; icon: string }> = [
    {
      id: "providers",
      label: "Providers",
      icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
    },
    {
      id: "models",
      label: "Models",
      icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
    },
    {
      id: "status",
      label: "Status",
      icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">AI Models</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure AI providers and models for chat and embeddings
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group inline-flex items-center py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              <svg
                className={`w-5 h-5 mr-2 ${
                  activeTab === tab.id ? "text-blue-500" : "text-gray-400 group-hover:text-gray-500"
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
              </svg>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === "providers" && <ProvidersTab />}
      {activeTab === "models" && <ModelsTab />}
      {activeTab === "status" && <StatusTab />}
    </div>
  );
}
