import { useState, useRef, useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import { marked } from 'marked';
import type { ChatMessage, Citation } from '../types';
import type { ChatStatus } from '../hooks/useChat';
import { ChevronDownIcon, BookIcon, FileIcon, SearchIcon, SparklesIcon, ExternalLinkIcon } from './Icons';

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

// Parse markdown and convert inline citations to hoverable badges
function parseMarkdown(text: string, citations?: ChatMessage['citations']): string {
  if (!text) return '';

  let cleaned = text;

  // Strip old/unwanted citation formats
  cleaned = cleaned.replace(/【[^】]*】/g, '');
  cleaned = cleaned.replace(/Citation:\s*[^\n.]+[.\n]/gi, '');
  cleaned = cleaned.replace(/\[Source:[^\]]*\]/gi, '');
  cleaned = cleaned.replace(/\(Source:[^)]*\)/gi, '');

  // Convert inline citations [1], [2] to hoverable badges with data attributes
  if (citations && citations.length > 0) {
    cleaned = cleaned.replace(/\[(\d+)\]/g, (match, num) => {
      const index = parseInt(num, 10);
      const citation = citations.find(c => c.index === index);
      if (citation) {
        const title = (citation.title || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const url = (citation.url || '').replace(/"/g, '&quot;');
        const snippet = (citation.snippet || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').slice(0, 150);
        const hostname = citation.url ? new URL(citation.url).hostname : '';

        return `<span class="grounded-inline-citation" data-index="${index}" data-title="${title}" data-url="${url}" data-snippet="${snippet}" data-hostname="${hostname}">${hostname || 'source'}</span>`;
      }
      return match;
    });
  } else {
    // Strip citation markers if no citations data (fallback)
    cleaned = cleaned.replace(/\[\d+\]/g, '');
  }

  // Use marked for full markdown parsing (supports tables, code blocks, etc.)
  const html = marked.parse(cleaned, { async: false }) as string;

  return html;
}

interface CitationTooltip {
  index: number;
  title: string;
  url: string;
  snippet: string;
  hostname: string;
  x: number;
  y: number;
}

export function Message({ message }: MessageProps): JSX.Element {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [tooltip, setTooltip] = useState<CitationTooltip | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const isUser = message.role === 'user';
  const hasCitations = message.citations && message.citations.length > 0;

  // Handle citation hover events via event delegation
  useEffect(() => {
    const bubble = bubbleRef.current;
    if (!bubble) return;

    const handleMouseEnter = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('grounded-inline-citation')) {
        const rect = target.getBoundingClientRect();
        const bubbleRect = bubble.getBoundingClientRect();
        setTooltip({
          index: parseInt(target.dataset.index || '0', 10),
          title: target.dataset.title || '',
          url: target.dataset.url || '',
          snippet: target.dataset.snippet || '',
          hostname: target.dataset.hostname || '',
          x: rect.left - bubbleRect.left,
          y: rect.bottom - bubbleRect.top + 4,
        });
      }
    };

    const handleMouseLeave = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('grounded-inline-citation')) {
        setTooltip(null);
      }
    };

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('grounded-inline-citation') && target.dataset.url) {
        window.open(target.dataset.url, '_blank', 'noopener,noreferrer');
      }
    };

    bubble.addEventListener('mouseenter', handleMouseEnter, true);
    bubble.addEventListener('mouseleave', handleMouseLeave, true);
    bubble.addEventListener('click', handleClick, true);

    return () => {
      bubble.removeEventListener('mouseenter', handleMouseEnter, true);
      bubble.removeEventListener('mouseleave', handleMouseLeave, true);
      bubble.removeEventListener('click', handleClick, true);
    };
  }, []);

  return (
    <div className={`grounded-message ${message.role}`}>
      <div
        ref={bubbleRef}
        className="grounded-message-bubble"
        dangerouslySetInnerHTML={{
          __html: isUser ? escapeHtml(message.content) : parseMarkdown(message.content, message.citations),
        }}
      />
      {message.isStreaming && <span className="grounded-cursor" />}

      {/* Citation HoverCard (ai-elements style) */}
      {tooltip && (
        <div
          className="grounded-citation-card"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
          onMouseEnter={() => {}}
          onMouseLeave={() => setTooltip(null)}
        >
          <div className="grounded-citation-card-header">
            <span className="grounded-citation-card-hostname">{tooltip.hostname}</span>
          </div>
          <div className="grounded-citation-card-body">
            {tooltip.title && (
              <div className="grounded-citation-card-title">{tooltip.title}</div>
            )}
            {tooltip.url && (
              <div className="grounded-citation-card-url">{tooltip.url}</div>
            )}
            {tooltip.snippet && (
              <div className="grounded-citation-card-snippet">{tooltip.snippet}</div>
            )}
            {tooltip.url && (
              <a
                href={tooltip.url}
                target="_blank"
                rel="noopener noreferrer"
                className="grounded-citation-card-link"
              >
                <ExternalLinkIcon />
                Open source
              </a>
            )}
          </div>
        </div>
      )}

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
