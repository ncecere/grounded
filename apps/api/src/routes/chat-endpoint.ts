import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { streamSSE } from "hono/streaming";
import { html } from "hono/html";
import { db } from "@grounded/db";
import {
  chatEndpointTokens,
  agents,
  agentKbs,
  retrievalConfigs,
  kbChunks,
  chatEvents,
  tenantQuotas,
} from "@grounded/db/schema";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { generateEmbedding } from "@grounded/embeddings";
import { generateRAGResponse, generateRAGResponseStream, type ChunkContext } from "@grounded/llm";
import { getVectorStore } from "@grounded/vector-store";
import type { Citation } from "@grounded/shared";
import { getConversation, addToConversation, checkRateLimit } from "@grounded/queue";
import { generateId } from "@grounded/shared";
import { NotFoundError, RateLimitError } from "../middleware/error-handler";

export const chatEndpointRoutes = new Hono();

// ============================================================================
// Validation Schemas
// ============================================================================

const chatRequestSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
});

// ============================================================================
// Get Chat Endpoint Config (Public - for hosted UI)
// ============================================================================

chatEndpointRoutes.get("/:token/config", async (c) => {
  const token = c.req.param("token");

  const endpointToken = await db.query.chatEndpointTokens.findFirst({
    where: and(
      eq(chatEndpointTokens.token, token),
      isNull(chatEndpointTokens.revokedAt)
    ),
  });

  if (!endpointToken) {
    throw new NotFoundError("Chat endpoint");
  }

  const agent = await db.query.agents.findFirst({
    where: and(
      eq(agents.id, endpointToken.agentId),
      isNull(agents.deletedAt)
    ),
  });

  if (!agent) {
    throw new NotFoundError("Agent");
  }

  return c.json({
    agentName: agent.name,
    description: agent.description || "Ask me anything. I'm here to assist you.",
    welcomeMessage: agent.welcomeMessage || "How can I help?",
    logoUrl: agent.logoUrl || null,
    endpointType: endpointToken.endpointType,
  });
});

// ============================================================================
// Hosted Chat Page (Public)
// ============================================================================

chatEndpointRoutes.get("/:token", async (c) => {
  const token = c.req.param("token");

  const endpointToken = await db.query.chatEndpointTokens.findFirst({
    where: and(
      eq(chatEndpointTokens.token, token),
      isNull(chatEndpointTokens.revokedAt)
    ),
  });

  if (!endpointToken) {
    return c.html(html`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Chat Not Found</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
          .container { text-align: center; padding: 2rem; }
          h1 { color: #111827; margin-bottom: 0.5rem; }
          p { color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Chat Not Found</h1>
          <p>This chat endpoint doesn't exist or has been revoked.</p>
        </div>
      </body>
      </html>
    `, 404);
  }

  // Only hosted endpoints should render the page
  if (endpointToken.endpointType !== "hosted") {
    return c.html(html`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>API Endpoint</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
          .container { text-align: center; padding: 2rem; max-width: 600px; }
          h1 { color: #111827; margin-bottom: 0.5rem; }
          p { color: #6b7280; }
          code { background: #e5e7eb; padding: 0.25rem 0.5rem; border-radius: 0.25rem; font-size: 0.875rem; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>API Endpoint</h1>
          <p>This is an API endpoint. Use it programmatically:</p>
          <p><code>POST /api/v1/c/${token}/chat</code></p>
        </div>
      </body>
      </html>
    `, 400);
  }

  const agent = await db.query.agents.findFirst({
    where: and(
      eq(agents.id, endpointToken.agentId),
      isNull(agents.deletedAt)
    ),
  });

  if (!agent) {
    return c.html(html`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Agent Not Found</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f9fafb; }
          .container { text-align: center; padding: 2rem; }
          h1 { color: #111827; margin-bottom: 0.5rem; }
          p { color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Agent Not Found</h1>
          <p>The agent for this chat has been removed.</p>
        </div>
      </body>
      </html>
    `, 404);
  }

  const agentName = agent.name;
  const welcomeMessage = agent.welcomeMessage || "How can I help you today?";
  const logoUrl = agent.logoUrl || "";
  const agentInitial = agentName.charAt(0).toUpperCase();

  return c.html(html`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${agentName}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
      <style>
        :root {
          --background: #ffffff;
          --foreground: #0a0a0a;
          --muted: #f4f4f5;
          --muted-foreground: #71717a;
          --primary: #2563eb;
          --primary-foreground: #ffffff;
          --border: #e4e4e7;
          --radius: 1rem;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        html, body {
          height: 100%;
          overflow: hidden;
        }

        body {
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          background: var(--background);
          color: var(--foreground);
          display: flex;
          flex-direction: column;
          -webkit-font-smoothing: antialiased;
        }

        /* Header */
        .header {
          flex-shrink: 0;
          background: var(--background);
          border-bottom: 1px solid var(--border);
          padding: 0.75rem 1rem;
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .header-logo {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          object-fit: cover;
        }

        .header-avatar {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          background: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--primary-foreground);
          font-size: 0.875rem;
          font-weight: 600;
        }

        .header-info h1 {
          font-size: 1.125rem;
          font-weight: 600;
          color: var(--foreground);
        }

        .header-info span {
          font-size: 0.75rem;
          color: var(--muted-foreground);
        }

        /* Chat Container */
        .chat-wrapper {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: var(--background);
        }

        .messages {
          flex: 1;
          overflow-y: auto;
          padding: 1rem;
          scroll-behavior: smooth;
        }

        .messages-inner {
          max-width: 48rem;
          margin: 0 auto;
        }

        /* Welcome State */
        .welcome {
          text-align: center;
          padding: 3rem 1.5rem;
        }

        .welcome-icon {
          width: 48px;
          height: 48px;
          margin: 0 auto 1rem;
          color: var(--muted-foreground);
        }

        .welcome h2 {
          font-size: 1.125rem;
          font-weight: 500;
          color: var(--foreground);
          margin-bottom: 0.5rem;
        }

        .welcome p {
          color: var(--muted-foreground);
          font-size: 0.875rem;
          max-width: 28rem;
          margin: 0 auto;
          line-height: 1.5;
        }

        /* Messages */
        .message {
          display: flex;
          margin-bottom: 1rem;
        }

        .message.user {
          justify-content: flex-end;
        }

        .message.assistant {
          justify-content: flex-start;
        }

        .message-bubble {
          max-width: 80%;
        }

        .message-content {
          padding: 0.5rem 1rem;
          border-radius: var(--radius);
          line-height: 1.5;
          font-size: 0.875rem;
        }

        .message.assistant .message-content {
          background: var(--muted);
          color: var(--foreground);
        }

        .message.user .message-content {
          background: var(--primary);
          color: var(--primary-foreground);
        }

        /* Citations */
        .citations {
          margin-top: 0.5rem;
        }

        .citations-trigger {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.25rem 0.625rem;
          background: var(--muted);
          border: 1px solid var(--border);
          border-radius: 9999px;
          font-size: 0.75rem;
          color: var(--muted-foreground);
          cursor: pointer;
          transition: all 0.15s;
        }

        .citations-trigger:hover {
          background: var(--border);
        }

        .citations-trigger svg {
          width: 12px;
          height: 12px;
        }

        .citations-content {
          display: none;
          margin-top: 0.5rem;
          padding: 0.5rem;
          background: var(--muted);
          border-radius: 0.5rem;
        }

        .citations-content.open {
          display: block;
        }

        .citation {
          display: block;
          padding: 0.375rem 0.5rem;
          font-size: 0.75rem;
          color: var(--primary);
          text-decoration: none;
          border-radius: 0.25rem;
          transition: background 0.15s;
        }

        .citation:hover {
          background: var(--border);
        }

        /* Loader */
        .loader {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          background: var(--muted);
          border-radius: var(--radius);
        }

        .loader-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid var(--border);
          border-top-color: var(--primary);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .loader span {
          font-size: 0.875rem;
          color: var(--muted-foreground);
        }

        /* Streaming cursor */
        .streaming-cursor {
          display: inline-block;
          width: 6px;
          height: 16px;
          background: var(--primary);
          margin-left: 2px;
          border-radius: 1px;
          animation: blink 1s step-end infinite;
        }

        @keyframes blink {
          50% { opacity: 0; }
        }

        /* Input Area */
        .input-area {
          flex-shrink: 0;
          background: var(--background);
          border-top: 1px solid var(--border);
          padding: 1rem;
        }

        .input-container {
          max-width: 48rem;
          margin: 0 auto;
          display: flex;
          align-items: flex-end;
          gap: 0.5rem;
          background: rgba(244, 244, 245, 0.5);
          border: 1px solid var(--border);
          border-radius: 0.75rem;
          padding: 0.5rem;
        }

        .input-container:focus-within {
          border-color: var(--primary);
          box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
        }

        .input-container textarea {
          flex: 1;
          border: none;
          background: transparent;
          padding: 0.5rem;
          font-size: 0.875rem;
          font-family: inherit;
          color: var(--foreground);
          resize: none;
          outline: none;
          min-height: 40px;
          max-height: 120px;
          line-height: 1.5;
        }

        .input-container textarea::placeholder {
          color: var(--muted-foreground);
        }

        .send-btn {
          flex-shrink: 0;
          width: 36px;
          height: 36px;
          border: none;
          border-radius: 0.5rem;
          background: var(--primary);
          color: var(--primary-foreground);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: opacity 0.15s;
        }

        .send-btn:hover:not(:disabled) {
          opacity: 0.9;
        }

        .send-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .send-btn svg {
          width: 16px;
          height: 16px;
        }

        /* Responsive */
        @media (max-width: 640px) {
          .message-bubble { max-width: 90%; }
        }

        /* Scrollbar */
        .messages::-webkit-scrollbar {
          width: 6px;
        }
        .messages::-webkit-scrollbar-track {
          background: transparent;
        }
        .messages::-webkit-scrollbar-thumb {
          background: var(--border);
          border-radius: 3px;
        }

        /* Powered By Footer */
        .powered-by {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.375rem;
          padding: 0.5rem;
          font-size: 0.6875rem;
          color: var(--muted-foreground);
          border-top: 1px solid var(--border);
          background: var(--background);
        }
        .powered-by a {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          color: var(--muted-foreground);
          text-decoration: none;
          transition: color 0.15s;
        }
        .powered-by a:hover {
          color: var(--foreground);
        }
        .powered-by img {
          width: 14px;
          height: 14px;
        }

        /* Markdown content styles */
        .markdown-content p {
          margin-bottom: 0.75rem;
        }
        .markdown-content p:last-child {
          margin-bottom: 0;
        }
        .markdown-content ul, .markdown-content ol {
          margin: 0.5rem 0;
          padding-left: 1.5rem;
        }
        .markdown-content li {
          margin-bottom: 0.25rem;
        }
        .markdown-content code {
          background: rgba(0, 0, 0, 0.06);
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.8125rem;
        }
        .markdown-content pre {
          background: #1e1e1e;
          color: #d4d4d4;
          padding: 0.75rem 1rem;
          border-radius: 0.5rem;
          overflow-x: auto;
          margin: 0.75rem 0;
        }
        .markdown-content pre code {
          background: none;
          padding: 0;
          color: inherit;
        }
        .markdown-content blockquote {
          border-left: 3px solid var(--border);
          padding-left: 1rem;
          margin: 0.75rem 0;
          color: var(--muted-foreground);
        }
        .markdown-content table {
          display: block;
          width: max-content;
          max-width: 100%;
          overflow-x: auto;
          border-collapse: collapse;
          margin: 0.75rem 0;
          font-size: 0.8125rem;
        }
        .markdown-content th, .markdown-content td {
          border: 1px solid var(--border);
          padding: 0.5rem;
          text-align: left;
          white-space: nowrap;
        }
        .markdown-content th {
          background: var(--muted);
          font-weight: 600;
        }
        .markdown-content a {
          color: var(--primary);
          text-decoration: none;
        }
        .markdown-content a:hover {
          text-decoration: underline;
        }
        .markdown-content strong {
          font-weight: 600;
        }
        .markdown-content h1, .markdown-content h2, .markdown-content h3 {
          font-weight: 600;
          margin: 1rem 0 0.5rem 0;
        }
        .markdown-content h1:first-child, .markdown-content h2:first-child, .markdown-content h3:first-child {
          margin-top: 0;
        }
        .markdown-content h1 { font-size: 1.25rem; }
        .markdown-content h2 { font-size: 1.125rem; }
        .markdown-content h3 { font-size: 1rem; }

        /* Inline Citations - Badge Trigger (ai-elements style) */
        .inline-citation {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          background: var(--muted);
          color: var(--muted-foreground);
          font-size: 0.6875rem;
          font-weight: 500;
          padding: 2px 8px;
          border-radius: 9999px;
          margin-left: 4px;
          text-decoration: none;
          cursor: pointer;
          transition: all 0.15s;
          vertical-align: baseline;
          line-height: 1.4;
          white-space: nowrap;
          border: 1px solid var(--border);
        }
        .inline-citation:hover {
          background: var(--border);
          color: var(--foreground);
        }

        /* Citation HoverCard (ai-elements style) */
        .citation-card {
          position: fixed;
          z-index: 10000;
          width: 320px;
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          overflow: hidden;
          pointer-events: auto;
          animation: fadeIn 0.15s ease-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        /* Card Header - like carousel header */
        .citation-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          background: var(--muted);
          padding: 0.5rem 0.75rem;
          border-radius: 0.5rem 0.5rem 0 0;
        }
        .citation-card-hostname {
          font-size: 0.6875rem;
          font-weight: 500;
          color: var(--muted-foreground);
        }
        /* Card Body - like InlineCitationSource */
        .citation-card-body {
          padding: 1rem;
          padding-left: 1.25rem;
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
        .citation-card-title {
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--foreground);
          line-height: 1.4;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .citation-card-url {
          font-size: 0.75rem;
          color: var(--muted-foreground);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          word-break: break-all;
        }
        .citation-card-snippet {
          font-size: 0.8125rem;
          color: var(--muted-foreground);
          line-height: 1.5;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .citation-card-link {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          margin-top: 0.5rem;
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--primary);
          text-decoration: none;
          transition: opacity 0.15s;
        }
        .citation-card-link:hover {
          opacity: 0.8;
        }
        .citation-card-link svg {
          width: 12px;
          height: 12px;
        }

        /* Status Indicator */
        .status-indicator {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.375rem 0.75rem;
          background: rgba(37, 99, 235, 0.1);
          color: var(--primary);
          border-radius: 9999px;
          font-size: 0.8125rem;
          font-weight: 500;
        }
        .status-indicator svg {
          width: 14px;
          height: 14px;
          animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .status-dots {
          display: flex;
          gap: 3px;
        }
        .status-dot {
          width: 4px;
          height: 4px;
          background: var(--primary);
          border-radius: 50%;
          animation: bounce 1.4s ease-in-out infinite;
        }
        .status-dot:nth-child(1) { animation-delay: 0s; }
        .status-dot:nth-child(2) { animation-delay: 0.2s; }
        .status-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
      </style>
      <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    </head>
    <body>
      <header class="header">
        ${logoUrl ? html`<img src="${logoUrl}" alt="" class="header-logo" />` : html`<div class="header-avatar">${agentInitial}</div>`}
        <div class="header-info">
          <h1>${agentName}</h1>
          <span>Knowledge Assistant</span>
        </div>
      </header>

      <div class="chat-wrapper">
        <div class="messages" id="messages">
          <div class="messages-inner">
            <div class="welcome" id="welcome">
              <svg class="welcome-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
              </svg>
              <h2>${welcomeMessage}</h2>
              <p>Ask ${agentName} anything. Your questions will be answered using the connected knowledge bases.</p>
            </div>
          </div>
        </div>
      </div>

      <div class="input-area">
        <div class="input-container">
          <textarea
            id="input"
            placeholder="Ask ${agentName} anything..."
            rows="1"
            onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault();sendMessage();}"
          ></textarea>
          <button class="send-btn" id="send-btn" onclick="sendMessage()" aria-label="Send message">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="powered-by">
        <span>Powered by</span>
        <a href="https://github.com/grounded-ai" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
          </svg>
          <strong>Grounded</strong>
        </a>
      </div>

      <script>
        (function() {
          var TOKEN = '${token}';
          var API_URL = '/api/v1/c/' + TOKEN + '/chat/stream';
          var conversationId = null;
          var isLoading = false;

          var messagesEl = document.getElementById('messages');
          var messagesInner = messagesEl.querySelector('.messages-inner');
          var inputEl = document.getElementById('input');
          var sendBtn = document.getElementById('send-btn');
          var welcomeEl = document.getElementById('welcome');

          function autoResize() {
            inputEl.style.height = 'auto';
            inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
          }
          inputEl.addEventListener('input', autoResize);

          function scrollToBottom() {
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }

          function escapeHtml(text) {
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
          }

          // Configure marked
          marked.setOptions({
            breaks: true,
            gfm: true
          });

          // Custom renderer to add target="_blank" to links
          var renderer = new marked.Renderer();
          renderer.link = function(data) {
            var href = data.href || '';
            var title = data.title || '';
            var text = data.text || '';
            var titleAttr = title ? ' title="' + title + '"' : '';
            return '<a href="' + href + '" target="_blank" rel="noopener noreferrer"' + titleAttr + '>' + text + '</a>';
          };
          marked.use({ renderer: renderer });

          var currentCitations = [];
          var citationCard = null;

          // Create citation hover card element
          function createCitationCard() {
            if (citationCard) return;
            citationCard = document.createElement('div');
            citationCard.className = 'citation-card';
            citationCard.style.display = 'none';
            document.body.appendChild(citationCard);
          }
          createCitationCard();

          function showCitationCard(el) {
            var index = el.dataset.index;
            var title = el.dataset.title || '';
            var url = el.dataset.url || '';
            var snippet = el.dataset.snippet || '';
            var hostname = el.dataset.hostname || '';

            // Build card HTML with header and body (ai-elements style)
            var html = '<div class="citation-card-header"><span class="citation-card-hostname">' + escapeHtml(hostname) + '</span></div>';
            html += '<div class="citation-card-body">';
            if (title) {
              html += '<div class="citation-card-title">' + escapeHtml(title) + '</div>';
            }
            if (url) {
              html += '<div class="citation-card-url">' + escapeHtml(url) + '</div>';
            }
            if (snippet) {
              html += '<div class="citation-card-snippet">' + escapeHtml(snippet) + '</div>';
            }
            if (url) {
              html += '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" class="citation-card-link">';
              html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
              html += 'Open source</a>';
            }
            html += '</div>';

            citationCard.innerHTML = html;

            var rect = el.getBoundingClientRect();
            citationCard.style.display = 'block';
            citationCard.style.left = rect.left + 'px';
            citationCard.style.top = (rect.bottom + 8) + 'px';

            // Adjust if card goes off-screen
            var cardRect = citationCard.getBoundingClientRect();
            if (cardRect.right > window.innerWidth - 16) {
              citationCard.style.left = (window.innerWidth - cardRect.width - 16) + 'px';
            }
            if (cardRect.bottom > window.innerHeight - 16) {
              citationCard.style.top = (rect.top - cardRect.height - 8) + 'px';
            }
          }

          function hideCitationCard() {
            if (citationCard) {
              citationCard.style.display = 'none';
            }
          }

          // Event delegation for citation hover
          document.addEventListener('mouseenter', function(e) {
            if (e.target.classList && e.target.classList.contains('inline-citation')) {
              showCitationCard(e.target);
            }
          }, true);

          document.addEventListener('mouseleave', function(e) {
            if (e.target.classList && e.target.classList.contains('inline-citation')) {
              setTimeout(function() {
                if (!citationCard.matches(':hover')) {
                  hideCitationCard();
                }
              }, 100);
            }
          }, true);

          // Hide card when mouse leaves it
          if (citationCard) {
            citationCard.addEventListener('mouseleave', hideCitationCard);
          }

          // Click to open URL
          document.addEventListener('click', function(e) {
            if (e.target.classList && e.target.classList.contains('inline-citation')) {
              var url = e.target.dataset.url;
              if (url) {
                window.open(url, '_blank', 'noopener,noreferrer');
              }
            }
          }, true);

          function parseMarkdown(text, citations) {
            if (!text) return '';
            var cleaned = text;
            // Strip old/unwanted citation formats
            cleaned = cleaned.replace(/【[^】]*】/g, '');
            cleaned = cleaned.replace(/Citation:\\s*[^\\n.]+[.\\n]/gi, '');
            cleaned = cleaned.replace(/\\[Source:[^\\]]*\\]/gi, '');
            cleaned = cleaned.replace(/\\(Source:[^)]*\\)/gi, '');

            // Convert inline citations [1], [2] to hoverable badges with data attributes
            if (citations && citations.length > 0) {
              cleaned = cleaned.replace(/\\[(\\d+)\\]/g, function(match, num) {
                var index = parseInt(num, 10);
                var citation = citations.find(function(c) { return c.index === index; });
                if (citation) {
                  var title = (citation.title || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                  var url = (citation.url || '').replace(/"/g, '&quot;');
                  var snippet = (citation.snippet || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').slice(0, 150);
                  var hostname = '';
                  try {
                    hostname = citation.url ? new URL(citation.url).hostname : '';
                  } catch(e) {}
                  return '<span class="inline-citation" data-index="' + index + '" data-title="' + title + '" data-url="' + url + '" data-snippet="' + snippet + '" data-hostname="' + hostname + '">' + (hostname || 'source') + '</span>';
                }
                return match;
              });
            } else {
              // Strip citation markers if no citations data
              cleaned = cleaned.replace(/\\[\\d+\\]/g, '');
            }

            return marked.parse(cleaned);
          }

          function formatUserMessage(text) {
            return escapeHtml(text).replace(/\\n/g, '<br>');
          }

          function addMessage(role, content, citations) {
            citations = citations || [];
            if (welcomeEl) {
              welcomeEl.remove();
              welcomeEl = null;
            }

            var div = document.createElement('div');
            div.className = 'message ' + role;

            var citationsHtml = '';
            if (citations.length > 0) {
              var citationId = 'citations-' + Date.now();
              citationsHtml = '<div class="citations">';
              citationsHtml += '<button class="citations-trigger" onclick="document.getElementById(\\'' + citationId + '\\').classList.toggle(\\'open\\')">';
              citationsHtml += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
              citationsHtml += citations.length + ' source' + (citations.length > 1 ? 's' : '');
              citationsHtml += '</button>';
              citationsHtml += '<div id="' + citationId + '" class="citations-content">';
              for (var i = 0; i < citations.length; i++) {
                var c = citations[i];
                if (c.url) {
                  citationsHtml += '<a class="citation" href="' + escapeHtml(c.url) + '" target="_blank" rel="noopener">' + escapeHtml(c.title || c.url) + '</a>';
                } else if (c.title) {
                  citationsHtml += '<span class="citation">' + escapeHtml(c.title) + '</span>';
                }
              }
              citationsHtml += '</div></div>';
            }

            var contentHtml;
            if (role === 'user') {
              contentHtml = '<div class="message-content">' + formatUserMessage(content) + '</div>';
            } else {
              contentHtml = '<div class="message-content markdown-content">' + parseMarkdown(content) + '</div>';
            }

            div.innerHTML = '<div class="message-bubble">' + contentHtml + citationsHtml + '</div>';
            messagesInner.appendChild(div);
            scrollToBottom();
            return div;
          }

          function showLoader(statusText) {
            statusText = statusText || 'Thinking...';
            if (welcomeEl) {
              welcomeEl.remove();
              welcomeEl = null;
            }
            var existingLoader = document.getElementById('loader');
            if (existingLoader) {
              // Update existing loader text
              var textEl = existingLoader.querySelector('.status-text');
              if (textEl) textEl.textContent = statusText;
              return;
            }
            var div = document.createElement('div');
            div.className = 'message assistant';
            div.id = 'loader';
            div.innerHTML = '<div class="message-bubble"><div class="status-indicator">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>' +
              '<span class="status-text">' + escapeHtml(statusText) + '</span>' +
              '<div class="status-dots"><div class="status-dot"></div><div class="status-dot"></div><div class="status-dot"></div></div>' +
              '</div></div>';
            messagesInner.appendChild(div);
            scrollToBottom();
          }

          function updateLoaderStatus(statusText, iconType) {
            var loader = document.getElementById('loader');
            if (!loader) {
              showLoader(statusText);
              return;
            }
            var textEl = loader.querySelector('.status-text');
            if (textEl) textEl.textContent = statusText;
            var iconEl = loader.querySelector('svg');
            if (iconEl && iconType === 'generating') {
              iconEl.outerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>';
            }
          }

          function hideLoader() {
            var loader = document.getElementById('loader');
            if (loader) loader.remove();
          }

          window.sendMessage = async function() {
            var message = inputEl.value.trim();
            if (!message || isLoading) return;

            isLoading = true;
            sendBtn.disabled = true;
            inputEl.value = '';
            autoResize();

            addMessage('user', message);
            showLoader('Searching knowledge base...');

            try {
              var requestBody = { message: message };
              if (conversationId) requestBody.conversationId = conversationId;

              var response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
              });

              if (!response.ok) throw new Error('Request failed');

              var reader = response.body.getReader();
              var decoder = new TextDecoder();
              var buffer = '';
              var fullText = '';
              var finalCitations = [];

              var assistantDiv = null;
              var contentEl = null;
              var bubbleEl = null;

              while (true) {
                var result = await reader.read();
                if (result.done) break;

                buffer += decoder.decode(result.value, { stream: true });
                var lines = buffer.split('\\n');
                buffer = lines.pop() || '';

                for (var i = 0; i < lines.length; i++) {
                  var line = lines[i];
                  if (line.indexOf('data: ') === 0) {
                    try {
                      var data = JSON.parse(line.slice(6));
                      if (data.type === 'status') {
                        // Handle status events
                        var statusMsg = data.message || (data.status === 'searching' ? 'Searching knowledge base...' : 'Generating response...');
                        updateLoaderStatus(statusMsg, data.status);
                      } else if (data.type === 'text') {
                        // First text chunk - hide loader and show assistant message
                        if (!fullText) {
                          hideLoader();
                          assistantDiv = addMessage('assistant', '');
                          contentEl = assistantDiv.querySelector('.message-content');
                          bubbleEl = assistantDiv.querySelector('.message-bubble');
                        }
                        fullText += data.content;
                        contentEl.innerHTML = parseMarkdown(fullText, currentCitations) + '<span class="streaming-cursor"></span>';
                        scrollToBottom();
                      } else if (data.type === 'done') {
                        conversationId = data.conversationId;
                        finalCitations = data.citations || [];
                        currentCitations = finalCitations;
                      }
                    } catch (e) {}
                  }
                }
              }

              // Hide loader if still showing (edge case)
              hideLoader();

              // Remove streaming cursor and add final content with citations
              if (contentEl) {
                contentEl.innerHTML = parseMarkdown(fullText, finalCitations);
              }

              if (finalCitations.length > 0 && bubbleEl) {
                var citationId = 'citations-' + Date.now();
                var citationsHtml = '<div class="citations">';
                citationsHtml += '<button class="citations-trigger" onclick="document.getElementById(\\'' + citationId + '\\').classList.toggle(\\'open\\')">';
                citationsHtml += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
                citationsHtml += finalCitations.length + ' source' + (finalCitations.length > 1 ? 's' : '');
                citationsHtml += '</button>';
                citationsHtml += '<div id="' + citationId + '" class="citations-content">';
                for (var j = 0; j < finalCitations.length; j++) {
                  var c = finalCitations[j];
                  if (c.url) {
                    citationsHtml += '<a class="citation" href="' + escapeHtml(c.url) + '" target="_blank" rel="noopener">' + escapeHtml(c.title || c.url) + '</a>';
                  } else if (c.title) {
                    citationsHtml += '<span class="citation">' + escapeHtml(c.title) + '</span>';
                  }
                }
                citationsHtml += '</div></div>';
                bubbleEl.innerHTML = '<div class="message-content markdown-content">' + parseMarkdown(fullText, finalCitations) + '</div>' + citationsHtml;
              }

            } catch (error) {
              console.error('Chat error:', error);
              hideLoader();
              addMessage('assistant', 'I apologize, but something went wrong. Please try again.');
            }

            isLoading = false;
            sendBtn.disabled = false;
            inputEl.focus();
          };

          inputEl.focus();
        })();
      </script>
    </body>
    </html>
  `);
});

// ============================================================================
// Chat Endpoint - Non-streaming (Public)
// ============================================================================

chatEndpointRoutes.post(
  "/:token/chat",
  zValidator("json", chatRequestSchema),
  async (c) => {
    const token = c.req.param("token");
    const body = c.req.valid("json");
    const startTime = Date.now();

    // Validate token
    const endpointToken = await db.query.chatEndpointTokens.findFirst({
      where: and(
        eq(chatEndpointTokens.token, token),
        isNull(chatEndpointTokens.revokedAt)
      ),
    });

    if (!endpointToken) {
      throw new NotFoundError("Chat endpoint");
    }

    // Get agent
    const agent = await db.query.agents.findFirst({
      where: and(
        eq(agents.id, endpointToken.agentId),
        isNull(agents.deletedAt)
      ),
    });

    if (!agent) {
      throw new NotFoundError("Agent");
    }

    // Check rate limit
    const quotas = await db.query.tenantQuotas.findFirst({
      where: eq(tenantQuotas.tenantId, endpointToken.tenantId),
    });

    const rateLimit = quotas?.chatRateLimitPerMinute || 60;
    const rateLimitResult = await checkRateLimit(
      `chat_endpoint:${endpointToken.tenantId}`,
      rateLimit,
      60
    );

    if (!rateLimitResult.allowed) {
      c.header("X-RateLimit-Limit", rateLimit.toString());
      c.header("X-RateLimit-Remaining", "0");
      c.header("Retry-After", "60");
      throw new RateLimitError(60);
    }

    // Get retrieval config
    const config = await db.query.retrievalConfigs.findFirst({
      where: eq(retrievalConfigs.agentId, agent.id),
    });

    const topK = config?.topK || 8;
    const candidateK = config?.candidateK || 40;
    const rerankerEnabled = config?.rerankerEnabled ?? true;
    const maxCitations = config?.maxCitations || 3;

    // Get attached KB IDs
    const attachedKbs = await db.query.agentKbs.findMany({
      where: and(eq(agentKbs.agentId, agent.id), isNull(agentKbs.deletedAt)),
    });

    const kbIds = attachedKbs.map((ak) => ak.kbId);

    if (kbIds.length === 0) {
      return c.json({
        answer: "I'm not configured with any knowledge sources yet.",
        citations: [],
        conversationId: body.conversationId || generateId(),
      });
    }

    // Get conversation history
    const conversationId = body.conversationId || generateId();
    const history = await getConversation(
      endpointToken.tenantId,
      agent.id,
      conversationId
    );

    // Retrieve relevant chunks
    const chunks = await retrieveChunks(
      endpointToken.tenantId,
      kbIds,
      body.message,
      candidateK,
      topK,
      rerankerEnabled
    );

    // Build context for RAG
    const chunkContexts: ChunkContext[] = chunks.map((chunk) => ({
      id: chunk.id,
      content: chunk.content,
      title: chunk.title,
      url: chunk.normalizedUrl,
      heading: chunk.heading,
    }));

    // Generate response
    const conversationHistory = history.map((turn) => ({
      role: turn.role as "user" | "assistant",
      content: turn.content,
    }));

    // Build complete system prompt including description
    const fullSystemPrompt = agent.description
      ? `${agent.systemPrompt}\n\nAgent Description: ${agent.description}`
      : agent.systemPrompt;

    const ragResponse = await generateRAGResponse(
      body.message,
      chunkContexts,
      {
        systemPrompt: fullSystemPrompt,
        conversationHistory,
        maxCitations,
      }
    );

    // Update conversation memory
    await addToConversation(endpointToken.tenantId, agent.id, conversationId, {
      role: "user",
      content: body.message,
      timestamp: Date.now(),
    });

    await addToConversation(endpointToken.tenantId, agent.id, conversationId, {
      role: "assistant",
      content: ragResponse.answer,
      timestamp: Date.now(),
    });

    // Log chat event
    const latencyMs = Date.now() - startTime;
    await db.insert(chatEvents).values({
      tenantId: endpointToken.tenantId,
      agentId: agent.id,
      userId: null,
      channel: "chat_endpoint",
      status: "ok",
      latencyMs,
      promptTokens: ragResponse.inputTokens,
      completionTokens: ragResponse.outputTokens,
      retrievedChunks: chunks.length,
      rerankerUsed: rerankerEnabled,
    });

    // Filter citations if disabled
    const citations = agent.citationsEnabled ? ragResponse.citations : [];

    return c.json({
      answer: ragResponse.answer,
      citations,
      conversationId,
    });
  }
);

// ============================================================================
// Chat Endpoint - Streaming (Public)
// ============================================================================

chatEndpointRoutes.post(
  "/:token/chat/stream",
  zValidator("json", chatRequestSchema),
  async (c) => {
    const token = c.req.param("token");
    const body = c.req.valid("json");
    const startTime = Date.now();

    // Validate token
    const endpointToken = await db.query.chatEndpointTokens.findFirst({
      where: and(
        eq(chatEndpointTokens.token, token),
        isNull(chatEndpointTokens.revokedAt)
      ),
    });

    if (!endpointToken) {
      throw new NotFoundError("Chat endpoint");
    }

    // Get agent
    const agent = await db.query.agents.findFirst({
      where: and(
        eq(agents.id, endpointToken.agentId),
        isNull(agents.deletedAt)
      ),
    });

    if (!agent) {
      throw new NotFoundError("Agent");
    }

    // Check rate limit
    const quotas = await db.query.tenantQuotas.findFirst({
      where: eq(tenantQuotas.tenantId, endpointToken.tenantId),
    });

    const rateLimit = quotas?.chatRateLimitPerMinute || 60;
    const rateLimitResult = await checkRateLimit(
      `chat_endpoint:${endpointToken.tenantId}`,
      rateLimit,
      60
    );

    if (!rateLimitResult.allowed) {
      c.header("X-RateLimit-Limit", rateLimit.toString());
      c.header("X-RateLimit-Remaining", "0");
      c.header("Retry-After", "60");
      throw new RateLimitError(60);
    }

    // Get retrieval config
    const config = await db.query.retrievalConfigs.findFirst({
      where: eq(retrievalConfigs.agentId, agent.id),
    });

    const topK = config?.topK || 8;
    const candidateK = config?.candidateK || 40;
    const rerankerEnabled = config?.rerankerEnabled ?? true;
    const maxCitations = config?.maxCitations || 3;

    // Get attached KB IDs
    const attachedKbs = await db.query.agentKbs.findMany({
      where: and(eq(agentKbs.agentId, agent.id), isNull(agentKbs.deletedAt)),
    });

    const kbIds = attachedKbs.map((ak) => ak.kbId);
    const conversationId = body.conversationId || generateId();

    if (kbIds.length === 0) {
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          data: JSON.stringify({
            type: "text",
            content: "I'm not configured with any knowledge sources yet.",
          }),
        });
        await stream.writeSSE({
          data: JSON.stringify({
            type: "done",
            conversationId,
            citations: [],
          }),
        });
      });
    }

    // Build complete system prompt including description
    const fullSystemPrompt = agent.description
      ? `${agent.systemPrompt}\n\nAgent Description: ${agent.description}`
      : agent.systemPrompt;

    // Disable proxy buffering for smooth streaming
    c.header("X-Accel-Buffering", "no");
    c.header("Cache-Control", "no-cache");

    return streamSSE(c, async (stream) => {
      let fullAnswer = "";
      let finalResponse: { answer: string; citations: Citation[]; inputTokens: number; outputTokens: number } | null = null;
      let chunks: any[] = [];

      try {
        // Send status: searching
        await stream.writeSSE({
          data: JSON.stringify({
            type: "status",
            status: "searching",
            message: "Searching knowledge base...",
          }),
        });

        // Get conversation history
        const history = await getConversation(
          endpointToken.tenantId,
          agent.id,
          conversationId
        );

        // Retrieve relevant chunks
        chunks = await retrieveChunks(
          endpointToken.tenantId,
          kbIds,
          body.message,
          candidateK,
          topK,
          rerankerEnabled
        );

        // Send status: generating with sources count
        await stream.writeSSE({
          data: JSON.stringify({
            type: "status",
            status: "generating",
            message: chunks.length > 0
              ? `Found ${chunks.length} relevant sources. Generating response...`
              : "Generating response...",
            sourcesCount: chunks.length,
          }),
        });

        // Build context for RAG
        const chunkContexts: ChunkContext[] = chunks.map((chunk) => ({
          id: chunk.id,
          content: chunk.content,
          title: chunk.title,
          url: chunk.normalizedUrl,
          heading: chunk.heading,
        }));

        const conversationHistory = history.map((turn) => ({
          role: turn.role as "user" | "assistant",
          content: turn.content,
        }));

        // Store user message first
        await addToConversation(endpointToken.tenantId, agent.id, conversationId, {
          role: "user",
          content: body.message,
          timestamp: Date.now(),
        });

        const generator = generateRAGResponseStream(
          body.message,
          chunkContexts,
          {
            systemPrompt: fullSystemPrompt,
            conversationHistory,
            maxCitations,
          }
        );

        // Stream text chunks
        while (true) {
          const { value, done } = await generator.next();
          if (done) {
            finalResponse = value;
            break;
          }
          fullAnswer += value;
          await stream.writeSSE({
            data: JSON.stringify({ type: "text", content: value }),
          });
        }

        // Store assistant message
        await addToConversation(endpointToken.tenantId, agent.id, conversationId, {
          role: "assistant",
          content: fullAnswer,
          timestamp: Date.now(),
        });

        // Log chat event
        const latencyMs = Date.now() - startTime;
        await db.insert(chatEvents).values({
          tenantId: endpointToken.tenantId,
          agentId: agent.id,
          userId: null,
          channel: "chat_endpoint",
          status: "ok",
          latencyMs,
          promptTokens: finalResponse?.inputTokens || 0,
          completionTokens: finalResponse?.outputTokens || 0,
          retrievedChunks: chunks.length,
          rerankerUsed: rerankerEnabled,
        });

        // Send final message with citations
        const citations = agent.citationsEnabled ? (finalResponse?.citations || []) : [];
        await stream.writeSSE({
          data: JSON.stringify({
            type: "done",
            conversationId,
            citations,
          }),
        });
      } catch (error) {
        console.error("[Chat Endpoint Stream] Error:", error);
        await stream.writeSSE({
          data: JSON.stringify({
            type: "error",
            message: "An error occurred while generating the response.",
          }),
        });
      }
    });
  }
);

// ============================================================================
// Retrieval Functions
// ============================================================================

async function retrieveChunks(
  tenantId: string,
  kbIds: string[],
  query: string,
  candidateK: number,
  topK: number,
  rerankerEnabled: boolean
): Promise<any[]> {
  // Get vector store
  const vectorStore = getVectorStore();
  if (!vectorStore) {
    console.warn("[Chat Endpoint] Vector store not configured, falling back to keyword search only");
    return retrieveChunksKeywordOnly(tenantId, kbIds, query, topK);
  }

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);

  // Vector similarity search using vector store
  const vectorResults = await vectorStore.search(queryEmbedding.embedding, {
    tenantId,
    kbIds,
    topK: candidateK,
  });

  // Get chunk IDs from vector results
  const vectorChunkIds = vectorResults.map((r) => r.id);

  // Fetch chunk details from app DB
  let vectorChunks: Array<typeof kbChunks.$inferSelect> = [];
  if (vectorChunkIds.length > 0) {
    vectorChunks = await db.query.kbChunks.findMany({
      where: and(
        inArray(kbChunks.id, vectorChunkIds),
        isNull(kbChunks.deletedAt)
      ),
    });
  }

  // Create a map of chunk details with vector scores
  const chunkMap = new Map<string, any>();
  for (const chunk of vectorChunks) {
    const vectorResult = vectorResults.find((r) => r.id === chunk.id);
    chunkMap.set(chunk.id, {
      ...chunk,
      vectorScore: vectorResult?.score || 0,
      keywordScore: 0,
    });
  }

  // Full-text search
  const kbIdsArrayLiteral = `{${kbIds.join(",")}}`;
  const keywordResults = await db.execute(sql`
    SELECT
      c.id,
      c.content,
      c.title,
      c.normalized_url as "normalizedUrl",
      c.heading,
      c.section_path,
      c.tags,
      c.keywords,
      ts_rank_cd(c.tsv, plainto_tsquery('english', ${query})) as rank
    FROM kb_chunks c
    WHERE c.tenant_id = ${tenantId}
      AND c.kb_id = ANY(${kbIdsArrayLiteral}::uuid[])
      AND c.deleted_at IS NULL
      AND c.tsv @@ plainto_tsquery('english', ${query})
    ORDER BY rank DESC
    LIMIT ${candidateK}
  `);

  // Merge keyword results
  const keywordRows = Array.isArray(keywordResults) ? keywordResults : (keywordResults as any).rows || [];
  for (const row of keywordRows as any[]) {
    const existing = chunkMap.get(row.id);
    if (existing) {
      existing.keywordScore = parseFloat(row.rank) || 0;
    } else {
      chunkMap.set(row.id, {
        ...row,
        vectorScore: 0,
        keywordScore: parseFloat(row.rank) || 0,
      });
    }
  }

  let chunks = Array.from(chunkMap.values());

  if (rerankerEnabled) {
    chunks = heuristicRerank(chunks, query);
  } else {
    chunks.sort((a, b) => b.vectorScore - a.vectorScore);
  }

  return chunks.slice(0, topK);
}

async function retrieveChunksKeywordOnly(
  tenantId: string,
  kbIds: string[],
  query: string,
  topK: number
): Promise<any[]> {
  const kbIdsArrayLiteral = `{${kbIds.join(",")}}`;

  const keywordResults = await db.execute(sql`
    SELECT
      c.*,
      ts_rank_cd(c.tsv, plainto_tsquery('english', ${query})) as rank
    FROM kb_chunks c
    WHERE c.tenant_id = ${tenantId}
      AND c.kb_id = ANY(${kbIdsArrayLiteral}::uuid[])
      AND c.deleted_at IS NULL
      AND c.tsv @@ plainto_tsquery('english', ${query})
    ORDER BY rank DESC
    LIMIT ${topK}
  `);

  const rows = Array.isArray(keywordResults) ? keywordResults : (keywordResults as any).rows || [];
  return rows.map((row: any) => ({
    ...row,
    score: parseFloat(row.rank) || 0,
  }));
}

function heuristicRerank(chunks: any[], query: string): any[] {
  const queryTerms = query.toLowerCase().split(/\s+/);

  for (const chunk of chunks) {
    const vectorWeight = 0.6;
    const keywordWeight = 0.3;
    const titleMatchWeight = 0.1;

    let titleBonus = 0;
    const titleLower = (chunk.title || "").toLowerCase();
    const headingLower = (chunk.heading || "").toLowerCase();

    for (const term of queryTerms) {
      if (titleLower.includes(term)) titleBonus += 0.5;
      if (headingLower.includes(term)) titleBonus += 0.3;
    }
    titleBonus = Math.min(titleBonus, 1);

    const normalizedKeywordScore = Math.min(chunk.keywordScore * 10, 1);

    chunk.score =
      chunk.vectorScore * vectorWeight +
      normalizedKeywordScore * keywordWeight +
      titleBonus * titleMatchWeight;
  }

  chunks.sort((a, b) => b.score - a.score);
  return chunks;
}
