"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { marked } from "marked";
import { api, type ChatMessage } from "../lib/api";
import { Button } from "../components/ui/button";
import { ArrowLeft, RotateCcw, MessageSquareText, Send } from "lucide-react";

// Configure marked for chat use (same as widget)
marked.setOptions({
  breaks: true,  // Convert \n to <br>
  gfm: true,     // GitHub Flavored Markdown
});

// Custom renderer to add target="_blank" to links
const renderer = new marked.Renderer();
renderer.link = ({ href, title, text }) => {
  const titleAttr = title ? ` title="${title}"` : '';
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline"${titleAttr}>${text}</a>`;
};
marked.use({ renderer });

import {
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
} from "../components/ai-elements/sources";
import { Suggestions, Suggestion } from "../components/ai-elements/suggestion";
import { Loader } from "../components/ai-elements/loader";

interface ChatProps {
  agentId: string;
  onBack: () => void;
}

// Citation sources component
function CitationSources({ citations }: { citations: ChatMessage["citations"] }) {
  if (!citations || citations.length === 0) return null;

  return (
    <Sources>
      <SourcesTrigger count={citations.length} />
      <SourcesContent>
        {citations.map((citation, i) => (
          <Source
            key={i}
            href={citation.url || "#"}
            title={citation.title || `Source ${i + 1}`}
          />
        ))}
      </SourcesContent>
    </Sources>
  );
}

// Parse markdown and strip citation artifacts (same as widget)
function parseMarkdown(text: string): string {
  if (!text) return '';

  let cleaned = text;

  // Strip various inline citation formats that LLMs might generate
  cleaned = cleaned.replace(/【[^】]*】/g, '');
  cleaned = cleaned.replace(/Citation:\s*[^\n.]+[.\n]/gi, '');
  cleaned = cleaned.replace(/\[Source:[^\]]*\]/gi, '');
  cleaned = cleaned.replace(/\[\d+\]/g, '');
  cleaned = cleaned.replace(/\(Source:[^)]*\)/gi, '');

  // Use marked for full markdown parsing (supports tables, code blocks, etc.)
  const html = marked.parse(cleaned, { async: false }) as string;

  return html;
}

// Markdown renderer using marked (same as widget)
function MarkdownContent({ content }: { content: string }) {
  return (
    <div
      className="markdown-content text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: parseMarkdown(content) }}
    />
  );
}

// Single chat message component
function ChatMessageBubble({
  message,
  isStreaming,
}: {
  message: ChatMessage;
  isStreaming?: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`${isUser ? "max-w-[80%]" : "max-w-full"}`}>
        <div
          className={`rounded-2xl px-4 py-2 ${
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
        >
          {isUser ? (
            <span className="text-sm">{message.content}</span>
          ) : (
            <>
              {message.content ? (
                <MarkdownContent content={message.content} />
              ) : (
                <span className="text-muted-foreground italic text-sm">Waiting for response...</span>
              )}
              {isStreaming && (
                <span className="inline-block w-1.5 h-4 bg-primary animate-pulse ml-0.5 rounded-sm" />
              )}
            </>
          )}
        </div>
        {!isUser && !isStreaming && <CitationSources citations={message.citations} />}
      </div>
    </div>
  );
}

export function Chat({ agentId, onBack }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [streamingContent, setStreamingContent] = useState("");
  const [inputValue, setInputValue] = useState("");
  const streamingContentRef = useRef("");
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

        // If last message is from user, add new assistant message
        if (lastMessage?.role === "user") {
          return [...prev, { role: "assistant", content: streamingContent }];
        }

        // If last message is assistant and streaming, update it
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

      setInputValue("");
      setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
      setIsLoading(true);
      setStreamingContent("");
      streamingContentRef.current = "";

      try {
        // Start streaming
        setIsLoading(false);
        setIsStreaming(true);

        await api.chatStream(
          agentId,
          userMessage,
          conversationId,
          // onChunk
          (text) => {
            streamingContentRef.current += text;
            setStreamingContent(streamingContentRef.current);
          },
          // onDone
          (data) => {
            const finalContent = streamingContentRef.current;

            setConversationId(data.conversationId);
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastIndex = newMessages.length - 1;
              if (lastIndex >= 0 && newMessages[lastIndex].role === "assistant") {
                newMessages[lastIndex] = {
                  ...newMessages[lastIndex],
                  content: finalContent,
                  citations: data.citations,
                };
              }
              return newMessages;
            });
            setIsStreaming(false);
            setStreamingContent("");
            streamingContentRef.current = "";
            // Refocus input after response completes
            setTimeout(() => inputRef.current?.focus(), 50);
          },
          // onError
          (error) => {
            console.error("Stream error:", error);
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content:
                  "I apologize, but I encountered an error processing your request. Please try again.",
              },
            ]);
            setIsStreaming(false);
            setStreamingContent("");
            streamingContentRef.current = "";
            setTimeout(() => inputRef.current?.focus(), 50);
          }
        );
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "I apologize, but I encountered an error processing your request. Please try again.",
          },
        ]);
        setIsLoading(false);
        setIsStreaming(false);
        streamingContentRef.current = "";
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    },
    [isLoading, isStreaming, agentId, conversationId, inputValue]
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
      <div className="absolute top-0 left-0 right-0 z-20 bg-background/95 backdrop-blur-sm border-b">
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

      {/* Scrollable Messages Area - with padding for header and input */}
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
              {messages.map((message, index) => (
                <ChatMessageBubble
                  key={index}
                  message={message}
                  isStreaming={
                    isStreaming &&
                    index === messages.length - 1 &&
                    message.role === "assistant"
                  }
                />
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl px-4 py-2 flex items-center gap-2">
                    <Loader size={16} />
                    <span className="text-muted-foreground text-sm">Thinking...</span>
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
                className="flex-1 resize-none bg-transparent border-0 outline-none text-sm min-h-[40px] max-h-[120px] py-2 px-2 placeholder:text-muted-foreground disabled:opacity-50"
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
