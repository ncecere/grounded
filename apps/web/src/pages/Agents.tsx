import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Agent } from "../lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible";

interface AgentsProps {
  onSelectAgent: (id: string) => void;
}

const defaultAgentForm = {
  name: "",
  description: "",
  systemPrompt: "You are a helpful assistant. Answer questions based on the provided context. If you don't know the answer, say so.",
  welcomeMessage: "How can I help?",
  logoUrl: "",
  kbIds: [] as string[],
  llmModelConfigId: "" as string,
};

const defaultRetrievalConfig = {
  candidateK: 40,
  topK: 8,
  maxCitations: 3,
  rerankerEnabled: true,
};

export function Agents({ onSelectAgent }: AgentsProps) {
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<Agent | null>(null);
  const [showConfigModal, setShowConfigModal] = useState<Agent | null>(null);
  const [newAgent, setNewAgent] = useState(defaultAgentForm);
  const [editAgent, setEditAgent] = useState(defaultAgentForm);
  const [retrievalConfig, setRetrievalConfig] = useState(defaultRetrievalConfig);
  const [searchSettingsOpen, setSearchSettingsOpen] = useState(false);

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

  // Fetch retrieval config when editing an agent
  const { data: fetchedRetrievalConfig } = useQuery({
    queryKey: ["retrieval-config", showEditModal?.id],
    queryFn: () => api.getRetrievalConfig(showEditModal!.id),
    enabled: !!showEditModal,
  });

  // Update retrieval config state when fetched
  useEffect(() => {
    if (fetchedRetrievalConfig) {
      setRetrievalConfig({
        candidateK: fetchedRetrievalConfig.candidateK || 40,
        topK: fetchedRetrievalConfig.topK || 8,
        maxCitations: fetchedRetrievalConfig.maxCitations || 3,
        rerankerEnabled: fetchedRetrievalConfig.rerankerEnabled ?? true,
      });
    } else {
      setRetrievalConfig(defaultRetrievalConfig);
    }
  }, [fetchedRetrievalConfig]);

  const createMutation = useMutation({
    mutationFn: api.createAgent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      setShowCreateModal(false);
      setNewAgent(defaultAgentForm);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteAgent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updateAgent>[1] }) =>
      api.updateAgent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });

  const updateRetrievalMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof retrievalConfig }) =>
      api.updateRetrievalConfig(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["retrieval-config"] });
      setShowEditModal(null);
    },
  });

  // Populate edit form when agent is selected for editing
  useEffect(() => {
    if (showEditModal) {
      setEditAgent({
        name: showEditModal.name,
        description: showEditModal.description || "",
        systemPrompt: showEditModal.systemPrompt,
        welcomeMessage: showEditModal.welcomeMessage || "How can I help?",
        logoUrl: showEditModal.logoUrl || "",
        kbIds: showEditModal.kbIds,
        llmModelConfigId: showEditModal.llmModelConfigId || "",
      });
    }
  }, [showEditModal]);

  const { data: widgetToken } = useQuery({
    queryKey: ["widget-token", showConfigModal?.id],
    queryFn: () => api.getWidgetToken(showConfigModal!.id),
    enabled: !!showConfigModal,
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgent.name.trim() || newAgent.kbIds.length === 0) return;
    createMutation.mutate({
      name: newAgent.name.trim(),
      description: newAgent.description.trim() || undefined,
      systemPrompt: newAgent.systemPrompt,
      welcomeMessage: newAgent.welcomeMessage || undefined,
      kbIds: newAgent.kbIds,
      llmModelConfigId: newAgent.llmModelConfigId || undefined,
    });
  };

  const toggleKb = (kbId: string) => {
    setNewAgent((prev) => ({
      ...prev,
      kbIds: prev.kbIds.includes(kbId)
        ? prev.kbIds.filter((id) => id !== kbId)
        : [...prev.kbIds, kbId],
    }));
  };

  const toggleEditKb = (kbId: string) => {
    setEditAgent((prev) => ({
      ...prev,
      kbIds: prev.kbIds.includes(kbId)
        ? prev.kbIds.filter((id) => id !== kbId)
        : [...prev.kbIds, kbId],
    }));
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showEditModal || !editAgent.name.trim() || editAgent.kbIds.length === 0) return;

    // Update agent and retrieval config
    await updateMutation.mutateAsync({
      id: showEditModal.id,
      data: {
        name: editAgent.name.trim(),
        description: editAgent.description.trim() || undefined,
        systemPrompt: editAgent.systemPrompt,
        welcomeMessage: editAgent.welcomeMessage || undefined,
        logoUrl: editAgent.logoUrl.trim() || null,
        kbIds: editAgent.kbIds,
        llmModelConfigId: editAgent.llmModelConfigId || null,
      },
    });

    // Update retrieval config
    updateRetrievalMutation.mutate({
      id: showEditModal.id,
      data: retrievalConfig,
    });
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48"></div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agents</h1>
          <p className="text-sm text-gray-500 mt-1">
            Create and manage chat agents for your knowledge bases
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create Agent
        </button>
      </div>

      {agents && agents.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <svg className="w-12 h-12 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">No agents yet</h3>
          <p className="mt-2 text-sm text-gray-500">Create an agent to start chatting with your knowledge bases</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-4 inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            Create Agent
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents?.map((agent) => (
            <div
              key={agent.id}
              className={`bg-white rounded-lg border p-5 hover:shadow-sm transition-all ${
                agent.isEnabled !== false
                  ? "border-gray-200 hover:border-blue-300"
                  : "border-gray-200 opacity-60"
              }`}
            >
              <div
                className="cursor-pointer"
                onClick={() => setShowEditModal(agent)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {agent.logoUrl && (
                      <img
                        src={agent.logoUrl}
                        alt=""
                        className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-gray-900 hover:text-blue-600 transition-colors truncate">
                          {agent.name}
                        </h3>
                        {agent.isEnabled === false && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 rounded-full flex-shrink-0">
                            Disabled
                          </span>
                        )}
                      </div>
                      {agent.description && (
                        <p className="mt-1 text-sm text-gray-500 line-clamp-2">{agent.description}</p>
                      )}
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-gray-400 ml-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </div>
                <div className="mt-3 text-sm text-gray-500">
                  <p>{agent.kbIds.length} knowledge base(s)</p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={() => onSelectAgent(agent.id)}
                  disabled={agent.isEnabled === false}
                  className="flex-1 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Test Chat
                </button>
                <button
                  onClick={() => setShowConfigModal(agent)}
                  className="px-3 py-2 text-sm font-medium text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  Widget
                </button>
                <button
                  onClick={() => {
                    if (confirm("Are you sure you want to delete this agent?")) {
                      deleteMutation.mutate(agent.id);
                    }
                  }}
                  className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <form onSubmit={handleCreate}>
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900">Create Agent</h2>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Name</label>
                    <input
                      type="text"
                      value={newAgent.name}
                      onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      placeholder="Support Agent"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Description</label>
                    <input
                      type="text"
                      value={newAgent.description}
                      onChange={(e) => setNewAgent({ ...newAgent, description: e.target.value })}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      placeholder="Helps users with product questions"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">System Prompt</label>
                    <textarea
                      value={newAgent.systemPrompt}
                      onChange={(e) => setNewAgent({ ...newAgent, systemPrompt: e.target.value })}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      rows={4}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Welcome Message</label>
                    <input
                      type="text"
                      value={newAgent.welcomeMessage}
                      onChange={(e) => setNewAgent({ ...newAgent, welcomeMessage: e.target.value })}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      placeholder="Hello! How can I help you today?"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">LLM Model</label>
                    {llmModels && llmModels.length > 0 ? (
                      <Select
                        value={newAgent.llmModelConfigId || "default"}
                        onValueChange={(value) => setNewAgent({ ...newAgent, llmModelConfigId: value === "default" ? "" : value })}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select LLM model" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">
                            Use default model
                          </SelectItem>
                          {llmModels.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.displayName} ({model.providerName})
                              {model.isDefault && " ★"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-sm text-gray-500">No LLM models configured. Add models in AI Models settings.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Knowledge Bases</label>
                    {knowledgeBases && knowledgeBases.length > 0 ? (
                      <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2">
                        {knowledgeBases.map((kb) => (
                          <label
                            key={kb.id}
                            className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={newAgent.kbIds.includes(kb.id)}
                              onChange={() => toggleKb(kb.id)}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">{kb.name}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">No knowledge bases available. Create one first.</p>
                    )}
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 bg-gray-50 rounded-b-lg flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || newAgent.kbIds.length === 0}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {createMutation.isPending ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Widget Config Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-gray-900">Widget Embed Code</h2>
              <p className="mt-2 text-sm text-gray-500">
                Add this script to your website to embed the chat widget.
              </p>
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Embed Script</label>
                <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
{`<script>
  (function(w,d,s,o,f,js,fjs){
    w['KCBWidget']=o;w[o]=w[o]||function(){
    (w[o].q=w[o].q||[]).push(arguments)};
    js=d.createElement(s);fjs=d.getElementsByTagName(s)[0];
    js.id=o;js.src=f;js.async=1;fjs.parentNode.insertBefore(js,fjs);
  })(window,document,'script','kcb','/widget.js');
  kcb('init', { token: '${widgetToken?.token || "loading..."}' });
</script>`}
                </pre>
                <div className="mt-3 flex gap-4">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `<script>\n  (function(w,d,s,o,f,js,fjs){\n    w['KCBWidget']=o;w[o]=w[o]||function(){\n    (w[o].q=w[o].q||[]).push(arguments)};\n    js=d.createElement(s);fjs=d.getElementsByTagName(s)[0];\n    js.id=o;js.src=f;js.async=1;fjs.parentNode.insertBefore(js,fjs);\n  })(window,document,'script','kcb','/widget.js');\n  kcb('init', { token: '${widgetToken?.token || ""}' });\n</script>`
                      );
                    }}
                    className="text-sm text-blue-600 hover:text-blue-700"
                  >
                    Copy to clipboard
                  </button>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 rounded-b-lg flex justify-between">
              <button
                onClick={() => {
                  const testHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Widget Test - ${showConfigModal?.name || 'Agent'}</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
    h1 { color: #1f2937; }
    p { color: #6b7280; line-height: 1.6; }
    .info { background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0; }
    code { background: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-size: 14px; }
  </style>
</head>
<body>
  <h1>Widget Test Page</h1>
  <p>This is a test page for the <strong>${showConfigModal?.name || 'Agent'}</strong> widget.</p>
  <div class="info">
    <p>The chat widget should appear in the bottom-right corner. Click the button to open it and test the conversation.</p>
    <p>Token: <code>${widgetToken?.token || 'loading...'}</code></p>
  </div>
  <p>Try asking questions to test your agent's responses and knowledge base integration.</p>

  <script>
    (function(w,d,s,o,f,js,fjs){
      w['KCBWidget']=o;w[o]=w[o]||function(){
      (w[o].q=w[o].q||[]).push(arguments)};
      js=d.createElement(s);fjs=d.getElementsByTagName(s)[0];
      js.id=o;js.src=f;js.async=1;fjs.parentNode.insertBefore(js,fjs);
    })(window,document,'script','kcb','${window.location.origin}/widget.js');
    kcb('init', { token: '${widgetToken?.token || ''}', apiBase: '${window.__KCB_CONFIG__?.API_URL || window.location.origin}' });
  </script>
</body>
</html>`;
                  const blob = new Blob([testHtml], { type: 'text/html' });
                  const url = URL.createObjectURL(blob);
                  window.open(url, '_blank');
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Test Widget
              </button>
              <button
                onClick={() => setShowConfigModal(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <form onSubmit={handleUpdate}>
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900">Edit Agent</h2>
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Name</label>
                    <input
                      type="text"
                      value={editAgent.name}
                      onChange={(e) => setEditAgent({ ...editAgent, name: e.target.value })}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      placeholder="Support Agent"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Description</label>
                    <input
                      type="text"
                      value={editAgent.description}
                      onChange={(e) => setEditAgent({ ...editAgent, description: e.target.value })}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      placeholder="Helps users with product questions"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">System Prompt</label>
                    <textarea
                      value={editAgent.systemPrompt}
                      onChange={(e) => setEditAgent({ ...editAgent, systemPrompt: e.target.value })}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      rows={4}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Welcome Message</label>
                    <input
                      type="text"
                      value={editAgent.welcomeMessage}
                      onChange={(e) => setEditAgent({ ...editAgent, welcomeMessage: e.target.value })}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      placeholder="How can I help?"
                    />
                    <p className="mt-1 text-xs text-gray-500">Shown in the widget empty state</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Logo URL</label>
                    <input
                      type="url"
                      value={editAgent.logoUrl}
                      onChange={(e) => setEditAgent({ ...editAgent, logoUrl: e.target.value })}
                      className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      placeholder="https://example.com/logo.png"
                    />
                    <p className="mt-1 text-xs text-gray-500">Displayed in widget header (32x32px)</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">LLM Model</label>
                    {llmModels && llmModels.length > 0 ? (
                      <Select
                        value={editAgent.llmModelConfigId || "default"}
                        onValueChange={(value) => setEditAgent({ ...editAgent, llmModelConfigId: value === "default" ? "" : value })}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select LLM model" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">
                            Use default model
                          </SelectItem>
                          {llmModels.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.displayName} ({model.providerName})
                              {model.isDefault && " ★"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-sm text-gray-500">No LLM models configured. Add models in AI Models settings.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Knowledge Bases</label>
                    {knowledgeBases && knowledgeBases.length > 0 ? (
                      <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2">
                        {knowledgeBases.map((kb) => (
                          <label
                            key={kb.id}
                            className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={editAgent.kbIds.includes(kb.id)}
                              onChange={() => toggleEditKb(kb.id)}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-700">{kb.name}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">No knowledge bases available. Create one first.</p>
                    )}
                  </div>

                  {/* Enable/Disable Toggle */}
                  <div className="flex items-center justify-between py-3 border-t border-gray-200">
                    <div>
                      <label className="text-sm font-medium text-gray-700">Agent Status</label>
                      <p className="text-xs text-gray-500">Disabled agents cannot be used for chat</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm ${showEditModal?.isEnabled !== false ? "text-green-600" : "text-gray-500"}`}>
                        {showEditModal?.isEnabled !== false ? "Enabled" : "Disabled"}
                      </span>
                      <Switch
                        checked={showEditModal?.isEnabled !== false}
                        onCheckedChange={(checked) => {
                          updateMutation.mutate({
                            id: showEditModal!.id,
                            data: { isEnabled: checked },
                          });
                        }}
                      />
                    </div>
                  </div>

                  {/* Search & Citation Settings - Collapsible */}
                  <Collapsible open={searchSettingsOpen} onOpenChange={setSearchSettingsOpen}>
                    <div className="pt-4 border-t border-gray-200">
                      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-left">
                        <h3 className="text-sm font-medium text-gray-900">Search & Citation Settings</h3>
                        <svg
                          className={`w-5 h-5 text-gray-500 transition-transform ${searchSettingsOpen ? "rotate-180" : ""}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-3">
                        <div className="space-y-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700">
                              Sources to Search
                            </label>
                            <p className="text-xs text-gray-500 mb-1">
                              How many sources are searched initially (broader = more thorough but slower)
                            </p>
                            <Select
                              value={String(retrievalConfig.candidateK)}
                              onValueChange={(value) => setRetrievalConfig({ ...retrievalConfig, candidateK: parseInt(value) })}
                            >
                              <SelectTrigger className="w-full mt-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="20">20 (Fast)</SelectItem>
                                <SelectItem value="40">40 (Balanced)</SelectItem>
                                <SelectItem value="60">60 (Thorough)</SelectItem>
                                <SelectItem value="100">100 (Very Thorough)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">
                              Sources for AI Context
                            </label>
                            <p className="text-xs text-gray-500 mb-1">
                              How many top sources the AI reads to form its answer
                            </p>
                            <Select
                              value={String(retrievalConfig.topK)}
                              onValueChange={(value) => setRetrievalConfig({ ...retrievalConfig, topK: parseInt(value) })}
                            >
                              <SelectTrigger className="w-full mt-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="3">3 (Minimal)</SelectItem>
                                <SelectItem value="5">5 (Focused)</SelectItem>
                                <SelectItem value="8">8 (Balanced)</SelectItem>
                                <SelectItem value="12">12 (Comprehensive)</SelectItem>
                                <SelectItem value="20">20 (Extensive)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">
                              Sources to Cite
                            </label>
                            <p className="text-xs text-gray-500 mb-1">
                              How many source citations are shown to the user
                            </p>
                            <Select
                              value={String(retrievalConfig.maxCitations)}
                              onValueChange={(value) => setRetrievalConfig({ ...retrievalConfig, maxCitations: parseInt(value) })}
                            >
                              <SelectTrigger className="w-full mt-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="1">1</SelectItem>
                                <SelectItem value="2">2</SelectItem>
                                <SelectItem value="3">3</SelectItem>
                                <SelectItem value="5">5</SelectItem>
                                <SelectItem value="8">8</SelectItem>
                                <SelectItem value="10">10</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex items-center justify-between py-2">
                            <div>
                              <span className="text-sm font-medium text-gray-700">Smart Ranking</span>
                              <p className="text-xs text-gray-500">
                                Re-rank search results by relevance (recommended)
                              </p>
                            </div>
                            <Switch
                              checked={retrievalConfig.rerankerEnabled}
                              onCheckedChange={(checked) => setRetrievalConfig({ ...retrievalConfig, rerankerEnabled: checked })}
                            />
                          </div>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                </div>
              </div>
              <div className="px-6 py-4 bg-gray-50 rounded-b-lg flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowEditModal(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending || updateRetrievalMutation.isPending || editAgent.kbIds.length === 0}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {(updateMutation.isPending || updateRetrievalMutation.isPending) ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
