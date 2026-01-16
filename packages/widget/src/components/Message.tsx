import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { marked } from 'marked';
import type { ChatMessage } from '../types';
import type { ChatStatus } from '../hooks/useChat';
import { ChevronDownIcon, BookIcon, FileIcon, SearchIcon, SparklesIcon } from './Icons';

// Configure marked for chat widget use
marked.setOptions({
  breaks: true,  // Convert \n to <br>
  gfm: true,     // GitHub Flavored Markdown (tables, strikethrough, etc.)
});

// Custom renderer to add target="_blank" to links
const renderer = new marked.Renderer();
renderer.link = ({ href, title, text }) => {
  const titleAttr = title ? ` title="${title}"` : '';
  return `<a href="${href}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
};
marked.use({ renderer });

interface MessageProps {
  message: ChatMessage;
}

// Escape HTML for user messages
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Parse markdown and strip inline citation markers
function parseMarkdown(text: string): string {
  if (!text) return '';

  let cleaned = text;

  // Strip all citation formats
  cleaned = cleaned.replace(/【[^】]*】/g, '');
  cleaned = cleaned.replace(/Citation:\s*[^\n.]+[.\n]/gi, '');
  cleaned = cleaned.replace(/\[Source:[^\]]*\]/gi, '');
  cleaned = cleaned.replace(/\(Source:[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\[\d+\]/g, ''); // Strip [1], [2], etc.

  // Use marked for full markdown parsing (supports tables, code blocks, etc.)
  const html = marked.parse(cleaned, { async: false }) as string;

  return html;
}

export function Message({ message }: MessageProps): JSX.Element {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const isUser = message.role === 'user';
  const hasCitations = message.citations && message.citations.length > 0;

  return (
    <div className={`grounded-message ${message.role}`}>
      <div
        className="grounded-message-bubble"
        dangerouslySetInnerHTML={{
          __html: isUser ? escapeHtml(message.content) : parseMarkdown(message.content),
        }}
      />
      {message.isStreaming && <span className="grounded-cursor" />}

      {/* Sources list at bottom of message */}
      {!isUser && hasCitations && (
        <div className="grounded-sources">
          <button
            className={`grounded-sources-trigger ${sourcesOpen ? 'open' : ''}`}
            onClick={() => setSourcesOpen(!sourcesOpen)}
          >
            <BookIcon />
            {message.citations!.length} source{message.citations!.length !== 1 ? 's' : ''}
            <ChevronDownIcon />
          </button>

          <div className={`grounded-sources-list ${sourcesOpen ? 'open' : ''}`}>
            {message.citations!.map((citation, i) => {
              const isUpload = citation.url?.startsWith('upload://');
              const displayTitle = citation.title || (isUpload ? 'Uploaded Document' : citation.url) || `Source ${i + 1}`;

              if (isUpload) {
                // For uploaded files, show as non-clickable item
                return (
                  <div key={i} className="grounded-source grounded-source-file">
                    <FileIcon />
                    <span className="grounded-source-title">{displayTitle}</span>
                  </div>
                );
              }

              // For web sources, show as clickable link
              return (
                <a
                  key={i}
                  href={citation.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="grounded-source"
                >
                  <BookIcon />
                  <span className="grounded-source-title">{displayTitle}</span>
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface StatusIndicatorProps {
  status: ChatStatus;
}

export function StatusIndicator({ status }: StatusIndicatorProps): JSX.Element {
  // Use server-provided message if available, otherwise build our own
  const getMessage = () => {
    if (status.message) {
      return status.message;
    }
    switch (status.status) {
      case 'searching':
        return 'Searching knowledge base...';
      case 'generating':
        return status.sourcesCount
          ? `Found ${status.sourcesCount} relevant sources. Generating...`
          : 'Generating response...';
      default:
        return 'Thinking...';
    }
  };

  const getIcon = () => {
    switch (status.status) {
      case 'searching':
        return <SearchIcon className="grounded-status-icon" />;
      case 'generating':
        return <SparklesIcon className="grounded-status-icon" />;
      default:
        return null;
    }
  };

  return (
    <div className="grounded-status">
      <div className="grounded-status-content">
        {getIcon()}
        <span className="grounded-status-text">{getMessage()}</span>
        <div className="grounded-status-dots">
          <div className="grounded-typing-dot" />
          <div className="grounded-typing-dot" />
          <div className="grounded-typing-dot" />
        </div>
      </div>
    </div>
  );
}

// Keep for backwards compatibility
export function TypingIndicator(): JSX.Element {
  return (
    <div className="grounded-typing">
      <div className="grounded-typing-dot" />
      <div className="grounded-typing-dot" />
      <div className="grounded-typing-dot" />
    </div>
  );
}
