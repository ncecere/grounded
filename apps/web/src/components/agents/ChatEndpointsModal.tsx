import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Code, Globe, Trash2, Copy, ExternalLink } from "lucide-react";
import { api } from "../../lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { Button } from "../ui/button";
import type { Agent, ChatEndpoint } from "./types";

interface ChatEndpointsModalProps {
  agent: Agent | null;
  onClose: () => void;
  onOpenTestChat: (agentId: string) => void;
}

export function ChatEndpointsModal({
  agent,
  onClose,
  onOpenTestChat,
}: ChatEndpointsModalProps) {
  const queryClient = useQueryClient();
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);

  const { data: chatEndpoints, isLoading } = useQuery({
    queryKey: ["chat-endpoints", agent?.id],
    queryFn: () => api.listChatEndpoints(agent!.id),
    enabled: !!agent,
  });

  const createChatEndpointMutation = useMutation({
    mutationFn: ({ agentId, data }: { agentId: string; data: { name?: string; endpointType: "api" | "hosted" } }) =>
      api.createChatEndpoint(agentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-endpoints", agent?.id] });
    },
  });

  const deleteChatEndpointMutation = useMutation({
    mutationFn: ({ agentId, endpointId }: { agentId: string; endpointId: string }) =>
      api.deleteChatEndpoint(agentId, endpointId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-endpoints", agent?.id] });
    },
  });

  const getEndpointUrl = (endpoint: ChatEndpoint) => {
    const baseUrl = window.__GROUNDED_CONFIG__?.API_URL || window.location.origin;
    if (endpoint.endpointType === "hosted") {
      return `${baseUrl}/chat/${endpoint.token}`;
    }
    return `${baseUrl}/api/v1/c/${endpoint.token}/chat`;
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedEndpoint(id);
    setTimeout(() => setCopiedEndpoint(null), 2000);
  };

  if (!agent) return null;

  return (
    <Dialog open={!!agent} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Chat Configuration</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Test and create public chat endpoints for {agent.name}
          </p>
        </DialogHeader>

        <div className="space-y-6">
          {/* Test Chat Section */}
          <div className="p-4 bg-muted rounded-lg border border-border">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-foreground">Test Chat</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Open a test conversation with this agent
                </p>
              </div>
              <Button
                onClick={() => {
                  onClose();
                  onOpenTestChat(agent.id);
                }}
              >
                Open Test Chat
              </Button>
            </div>
          </div>

          {/* Create Endpoint Buttons */}
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">Public Endpoints</h3>
            <div className="flex gap-3">
              <button
                onClick={() =>
                  createChatEndpointMutation.mutate({
                    agentId: agent.id,
                    data: { endpointType: "api", name: `API Endpoint ${(chatEndpoints?.length || 0) + 1}` },
                  })
                }
                disabled={createChatEndpointMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-border rounded-lg hover:border-primary/50 hover:bg-primary/5 transition-colors"
              >
                <Code className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">Create API Endpoint</span>
              </button>
              <button
                onClick={() =>
                  createChatEndpointMutation.mutate({
                    agentId: agent.id,
                    data: { endpointType: "hosted", name: `Chat Page ${(chatEndpoints?.length || 0) + 1}` },
                  })
                }
                disabled={createChatEndpointMutation.isPending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-border rounded-lg hover:border-purple-500/50 hover:bg-purple-500/5 transition-colors"
              >
                <Globe className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">Create Hosted Chat Page</span>
              </button>
            </div>
          </div>

          {/* Endpoints List */}
          {isLoading ? (
            <div className="py-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto" />
              <p className="mt-2 text-sm text-muted-foreground">Loading endpoints...</p>
            </div>
          ) : chatEndpoints && chatEndpoints.length > 0 ? (
            <div className="space-y-3">
              {chatEndpoints.map((endpoint) => (
                <div
                  key={endpoint.id}
                  className={`p-4 rounded-lg border ${
                    endpoint.endpointType === "api"
                      ? "border-primary/30 bg-primary/5"
                      : "border-purple-500/30 bg-purple-500/5"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      {endpoint.endpointType === "api" ? (
                        <Code className="w-5 h-5 text-primary" />
                      ) : (
                        <Globe className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                      )}
                      <div>
                        <p className="font-medium text-foreground">
                          {endpoint.name || (endpoint.endpointType === "api" ? "API Endpoint" : "Hosted Chat")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {endpoint.endpointType === "api" ? "JSON API" : "Shareable Link"} · Created{" "}
                          {new Date(endpoint.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        if (confirm("Are you sure you want to revoke this endpoint?")) {
                          deleteChatEndpointMutation.mutate({
                            agentId: agent.id,
                            endpointId: endpoint.id,
                          });
                        }
                      }}
                      className="p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-card rounded px-2 py-1.5 border border-border truncate">
                        {getEndpointUrl(endpoint)}
                      </code>
                      <button
                        onClick={() => copyToClipboard(getEndpointUrl(endpoint), endpoint.id)}
                        className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                        title="Copy URL"
                      >
                        {copiedEndpoint === endpoint.id ? (
                          <span className="text-success text-xs font-medium">Copied!</span>
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                      {endpoint.endpointType === "hosted" && (
                        <a
                          href={getEndpointUrl(endpoint)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                          title="Open in new tab"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>

                  {endpoint.endpointType === "api" && (
                    <div className="mt-3 text-xs text-muted-foreground">
                      <p className="font-medium mb-1">Usage:</p>
                      <pre className="bg-gray-900 text-gray-100 p-2 rounded overflow-x-auto">
{`curl -X POST "${getEndpointUrl(endpoint)}" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Hello"}'`}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center border-2 border-dashed border-border rounded-lg">
              <Code className="w-10 h-10 mx-auto text-muted-foreground" />
              <h3 className="mt-3 text-sm font-medium text-foreground">No public endpoints yet</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Create an API endpoint or hosted chat page to share with others.
              </p>
            </div>
          )}

          {/* Info boxes */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-primary/10 rounded-lg border border-primary/20">
              <div className="flex items-center gap-2 font-medium text-primary mb-1">
                <Code className="w-4 h-4" />
                API Endpoint
              </div>
              <p className="text-primary/80">For programmatic access. Returns JSON responses.</p>
            </div>
            <div className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
              <div className="flex items-center gap-2 font-medium text-purple-600 dark:text-purple-400 mb-1">
                <Globe className="w-4 h-4" />
                Hosted Chat Page
              </div>
              <p className="text-purple-600/80 dark:text-purple-400/80">
                A shareable link to a full-page chat interface.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
