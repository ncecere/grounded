import { memo, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { ChatMessage } from "../../lib/api";
import { BookOpen, ChevronDown, ExternalLink } from "lucide-react";

// Parse markdown and clean up any citation references from the text
function parseMarkdown(text: string): string {
  if (!text) return '';

  let cleaned = text;

  // Strip citation formats that the LLM might add
  cleaned = cleaned.replace(/【[^】]*】/g, '');
  cleaned = cleaned.replace(/Citation:\s*[^\n.]+[.\n]/gi, '');
  cleaned = cleaned.replace(/\[Source:[^\]]*\]/gi, '');
  cleaned = cleaned.replace(/\(Source:[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\[\d+\]/g, ''); // Remove [1], [2], etc.

  const html = marked.parse(cleaned, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  });
}

// Simple markdown renderer
const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <div
      className="markdown-content text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: parseMarkdown(content) }}
    />
  );
});

// Simple sources component with local expand/collapse state
function MessageSources({ citations }: { citations: ChatMessage["citations"] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!citations || citations.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
      >
        <BookOpen className="h-3.5 w-3.5" />
        <span>Used {citations.length} sources</span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-1.5 pl-5">
          {citations.map((citation, i) => (
            <a
              key={citation.url || `citation-${i}`}
              href={citation.url || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors group"
            >
              <ExternalLink className="h-3 w-3 opacity-50 group-hover:opacity-100" />
              <span className="truncate">{citation.title || `Source ${i + 1}`}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// Single chat message component
export const ChatMessageBubble = memo(function ChatMessageBubble({
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
        {!isUser && !isStreaming && <MessageSources citations={message.citations} />}
      </div>
    </div>
  );
});
