import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { marked } from 'marked';
import type { ChatMessage } from '../types';
import { ChevronDownIcon, BookIcon, FileIcon } from './Icons';

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

// Parse markdown and strip citation artifacts
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

export function Message({ message }: MessageProps): JSX.Element {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const isUser = message.role === 'user';
  const hasCitations = message.citations && message.citations.length > 0;

  return (
    <div className={`kcb-message ${message.role}`}>
      <div
        className="kcb-message-bubble"
        dangerouslySetInnerHTML={{
          __html: isUser ? escapeHtml(message.content) : parseMarkdown(message.content),
        }}
      />
      {message.isStreaming && <span className="kcb-cursor" />}

      {!isUser && hasCitations && (
        <div className="kcb-sources">
          <button
            className={`kcb-sources-trigger ${sourcesOpen ? 'open' : ''}`}
            onClick={() => setSourcesOpen(!sourcesOpen)}
          >
            <BookIcon />
            {message.citations!.length} source{message.citations!.length !== 1 ? 's' : ''}
            <ChevronDownIcon />
          </button>

          <div className={`kcb-sources-list ${sourcesOpen ? 'open' : ''}`}>
            {message.citations!.map((citation, i) => {
              const isUpload = citation.url?.startsWith('upload://');
              const displayTitle = citation.title || (isUpload ? 'Uploaded Document' : citation.url) || `Source ${i + 1}`;

              if (isUpload) {
                // For uploaded files, show as non-clickable item
                return (
                  <div key={i} className="kcb-source kcb-source-file">
                    <FileIcon />
                    <span className="kcb-source-title">{displayTitle}</span>
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
                  className="kcb-source"
                >
                  <BookIcon />
                  <span className="kcb-source-title">{displayTitle}</span>
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function TypingIndicator(): JSX.Element {
  return (
    <div className="kcb-typing">
      <div className="kcb-typing-dot" />
      <div className="kcb-typing-dot" />
      <div className="kcb-typing-dot" />
    </div>
  );
}
