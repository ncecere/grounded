"use client";

import { useState, useRef, useEffect, useCallback, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { marked } from "marked";
import { api, type ChatMessage, type ReasoningStep } from "../lib/api";
import { Button } from "../components/ui/button";
import { ArrowLeft, RotateCcw, MessageSquareText, Send } from "lucide-react";
import {
  ReasoningSteps,
  ReasoningStepsTrigger,
  ReasoningStepsContent,
} from "../components/ai-elements/reasoning-steps";
import { Suggestions, Suggestion } from "../components/ai-elements/suggestion";
import { Loader } from "../components/ai-elements/loader";
import { ChatMessageBubble } from "./chat/ChatMessageBubble";

// Configure marked for chat use
marked.setOptions({
  breaks: true,
  gfm: true,
});

// Custom renderer to add target="_blank" to links
const renderer = new marked.Renderer();
renderer.link = ({ href, title, text }) => {
  const titleAttr = title ? ` title="${title}"` : '';
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline"${titleAttr}>${text}</a>`;
};
marked.use({ renderer });

interface ChatProps {
  agentId: string;
  onBack: () => void;
}

export function Chat({ agentId, onBack }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [streamingContent, setStreamingContent] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [reasoningSteps, setReasoningSteps] = useState<ReasoningStep[]>([]);
  const streamingContentRef = useRef("");
  const pendingSourcesRef = useRef<ChatMessage["citations"]>([]);
  const pendingReasoningStepsRef = useRef<Map<string, ReasoningStep>>(new Map());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: agent } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => api.getAgent(agentId),
  });

  // Set welcome message when agent loads
  useEffect(() => {
    if (agent?.welcomeMessage && messages.length === 0) {
      setMessages([{ role: "assistant", content: agent.welcomeMessage }]);
    }
  }, [agent?.welcomeMessage, messages.length]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // Update messages when streaming content changes
  useEffect(() => {
    if (isStreaming && streamingContent) {
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastMessage = newMessages[newMessages.length - 1];

        if (lastMessage?.role === "user") {
          return [...prev, { role: "assistant", content: streamingContent }];
        }

        if (lastMessage?.role === "assistant") {
          newMessages[newMessages.length - 1] = {
            ...lastMessage,
            content: streamingContent,
          };
          return newMessages;
        }

        return prev;
      });
    }
  }, [isStreaming, streamingContent]);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const userMessage = inputValue.trim();
      if (!userMessage || isLoading || isStreaming) return;

      const isAdvancedMode = agent?.ragType === "advanced";

      setInputValue("");
      setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
      setIsLoading(true);
      setStreamingContent("");
      streamingContentRef.current = "";
      pendingSourcesRef.current = [];
      pendingReasoningStepsRef.current.clear();
      setReasoningSteps([]);
      setStatusMessage(isAdvancedMode ? "Analyzing query..." : "Searching knowledge base...");

      const onChunk = (text: string) => {
        setIsLoading(false);
        setIsStreaming(true);
        streamingContentRef.current += text;
        setStreamingContent(streamingContentRef.current);
      };

      const onSources = (sources: Array<{ id: string; title: string; url?: string; snippet: string; index: number }>) => {
        const citations: ChatMessage["citations"] = sources.map((s) => ({
          index: s.index,
          title: s.title,
          url: s.url,
          snippet: s.snippet,
        }));
        pendingSourcesRef.current = citations;
      };

      const onDone = (newConversationId: string) => {
        const finalContent = streamingContentRef.current;
        const citationsToSet = pendingSourcesRef.current ? [...pendingSourcesRef.current] : [];

        setConversationId(newConversationId);
        setMessages((prev) => {
          const newMessages = [...prev];
          const lastIndex = newMessages.length - 1;
          if (lastIndex >= 0 && newMessages[lastIndex].role === "assistant") {
            newMessages[lastIndex] = {
              ...newMessages[lastIndex],
              content: finalContent,
              citations: citationsToSet,
            };
          }
          return newMessages;
        });
        setIsStreaming(false);
        setStreamingContent("");
        streamingContentRef.current = "";
        pendingSourcesRef.current = [];
        setStatusMessage("");
        setTimeout(() => inputRef.current?.focus(), 50);
      };

      const onError = (error: string) => {
        console.error("Stream error:", error);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "I apologize, but I encountered an error processing your request. Please try again.",
          },
        ]);
        setIsLoading(false);
        setIsStreaming(false);
        setStreamingContent("");
        streamingContentRef.current = "";
        pendingSourcesRef.current = [];
        pendingReasoningStepsRef.current.clear();
        setReasoningSteps([]);
        setStatusMessage("");
        setTimeout(() => inputRef.current?.focus(), 50);
      };

      const onStatus = (status: { status: string; message: string; sourceCount?: number }) => {
        setStatusMessage(status.message);
      };

      const onReasoning = (step: ReasoningStep) => {
        pendingReasoningStepsRef.current.set(step.id, step);
        setReasoningSteps(Array.from(pendingReasoningStepsRef.current.values()));
      };

      try {
        await api.chatStream(
          agentId,
          userMessage,
          conversationId,
          onChunk,
          onSources,
          onDone,
          onError,
          {
            onReasoning: isAdvancedMode ? onReasoning : undefined,
            onStatus,
          }
        );
      } catch (error) {
        console.error("Chat error:", error);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "I apologize, but I encountered an error processing your request. Please try again.",
          },
        ]);
        setIsLoading(false);
        setIsStreaming(false);
        streamingContentRef.current = "";
        pendingSourcesRef.current = [];
        pendingReasoningStepsRef.current.clear();
        setReasoningSteps([]);
        setStatusMessage("");
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    },
    [isLoading, isStreaming, agentId, conversationId, inputValue, agent?.ragType]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleClearChat = () => {
    setMessages(
      agent?.welcomeMessage
        ? [{ role: "assistant", content: agent.welcomeMessage }]
        : []
    );
    setConversationId(undefined);
    setStreamingContent("");
    streamingContentRef.current = "";
    setIsStreaming(false);
    pendingSourcesRef.current = [];
    pendingReasoningStepsRef.current.clear();
    setReasoningSteps([]);
    setStatusMessage("");
  };

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      setInputValue(suggestion);
      setTimeout(() => {
        handleSubmit();
      }, 0);
    },
    [handleSubmit]
  );

  const showEmptyState =
    messages.length === 0 ||
    (messages.length === 1 &&
      messages[0].role === "assistant" &&
      messages[0].content === agent?.welcomeMessage);

  const showSuggestions =
    showEmptyState &&
    agent?.suggestedQuestions &&
    agent.suggestedQuestions.length > 0;

  return (
    <div className="relative h-full w-full bg-background">
      {/* Fixed Header */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-background/95 backdrop-blur-xs border-b">
        <div className="flex items-center gap-3 px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>

          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold truncate">
              {agent?.name || "Chat"}
            </h1>
            <p className="text-xs text-muted-foreground">Test your agent</p>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearChat}
            className="text-muted-foreground hover:text-foreground gap-1.5"
          >
            <RotateCcw className="w-4 h-4" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        </div>
      </div>

      {/* Scrollable Messages Area */}
      <div className="absolute top-0 left-0 right-0 bottom-0 overflow-y-auto pt-[72px] pb-[140px]">
        <div className="max-w-3xl mx-auto px-4 py-4">
          {showEmptyState && !agent?.welcomeMessage ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center">
              <MessageSquareText className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">Start a conversation</h3>
              <p className="text-muted-foreground text-sm max-w-md">
                Ask {agent?.name || "the agent"} anything. Your questions will be answered using the connected knowledge bases.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message, index) => {
                const isLastMessage = index === messages.length - 1;
                const isStreamingAssistant = isStreaming && isLastMessage && message.role === "assistant";
                const isLastAssistant = isLastMessage && message.role === "assistant";
                const showReasoningBeforeThis = isLastAssistant &&
                  agent?.ragType === "advanced" &&
                  reasoningSteps.length > 0;

                return (
                  <Fragment key={message.content ? `${message.role}-${index}-${message.citations?.length || 0}` : `${message.role}-${index}`}>
                    {/* Reasoning steps panel ABOVE the last assistant message */}
                    {showReasoningBeforeThis && (
                      <div className="flex justify-start">
                        <div className="max-w-full">
                          <ReasoningSteps
                            steps={reasoningSteps}
                            isStreaming={isLoading || isStreaming}
                            defaultOpen={false}
                          >
                            <ReasoningStepsTrigger steps={reasoningSteps} />
                            <ReasoningStepsContent steps={reasoningSteps} />
                          </ReasoningSteps>
                        </div>
                      </div>
                    )}
                    <ChatMessageBubble
                      message={message}
                      isStreaming={isStreamingAssistant}
                    />
                  </Fragment>
                );
              })}

              {/* Reasoning steps when still loading (before assistant message exists) */}
              {agent?.ragType === "advanced" &&
                reasoningSteps.length > 0 &&
                messages.length > 0 &&
                messages[messages.length - 1].role !== "assistant" && (
                <div className="flex justify-start">
                  <div className="max-w-full">
                    <ReasoningSteps
                      steps={reasoningSteps}
                      isStreaming={isLoading || isStreaming}
                      defaultOpen={false}
                    >
                      <ReasoningStepsTrigger steps={reasoningSteps} />
                      <ReasoningStepsContent steps={reasoningSteps} />
                    </ReasoningSteps>
                  </div>
                </div>
              )}

              {/* Simple loading indicator (for simple mode or before reasoning starts) */}
              {isLoading && (agent?.ragType !== "advanced" || reasoningSteps.length === 0) && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl px-4 py-2 flex items-center gap-2">
                    <Loader size={16} />
                    <span className="text-muted-foreground text-sm">
                      {statusMessage || "Searching knowledge base..."}
                    </span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Fixed Input Area */}
      <div className="absolute bottom-0 left-0 right-0 z-20 bg-background border-t">
        {/* Suggested questions */}
        {showSuggestions && (
          <div className="px-4 py-3 border-b bg-muted/30">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Try asking:
            </p>
            <Suggestions>
              {agent.suggestedQuestions.slice(0, 4).map((question, i) => (
                <Suggestion
                  key={i}
                  suggestion={question}
                  onClick={handleSuggestionClick}
                />
              ))}
            </Suggestions>
          </div>
        )}

        {/* Input */}
        <div className="p-4">
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
            <div className="flex items-end gap-2 bg-muted/50 rounded-xl border p-2">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Ask ${agent?.name || "the agent"} anything...`}
                disabled={isLoading || isStreaming}
                className="flex-1 resize-none bg-transparent border-0 outline-hidden text-sm min-h-[40px] max-h-[120px] py-2 px-2 placeholder:text-muted-foreground disabled:opacity-50"
                rows={1}
              />
              <Button
                type="submit"
                size="icon"
                disabled={isLoading || isStreaming || !inputValue.trim()}
                className="shrink-0"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
