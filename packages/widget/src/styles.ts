// Clean Modern Design System
// Blue palette with Noto Sans + IBM Plex Mono

export const styles = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans:wght@400;500;600&display=swap');

  :host {
    /* Color System - Cool Blue Palette */
    --kcb-bg-primary: #F8FAFC;
    --kcb-bg-secondary: #F1F5F9;
    --kcb-bg-tertiary: #E2E8F0;
    --kcb-bg-elevated: #FFFFFF;

    --kcb-text-primary: #0F172A;
    --kcb-text-secondary: #475569;
    --kcb-text-tertiary: #94A3B8;
    --kcb-text-inverse: #FFFFFF;

    /* Blue Accent */
    --kcb-accent: #3B82F6;
    --kcb-accent-hover: #2563EB;
    --kcb-accent-subtle: #EFF6FF;

    /* Borders & Shadows */
    --kcb-border: #E2E8F0;
    --kcb-border-subtle: #F1F5F9;
    --kcb-shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.04);
    --kcb-shadow-md: 0 4px 12px rgba(15, 23, 42, 0.08);
    --kcb-shadow-lg: 0 12px 40px rgba(15, 23, 42, 0.12);
    --kcb-shadow-xl: 0 20px 60px rgba(15, 23, 42, 0.16);

    /* Typography */
    --kcb-font-sans: 'Noto Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    --kcb-font-mono: 'IBM Plex Mono', 'SF Mono', Monaco, monospace;

    /* Spacing */
    --kcb-space-xs: 4px;
    --kcb-space-sm: 8px;
    --kcb-space-md: 16px;
    --kcb-space-lg: 24px;
    --kcb-space-xl: 32px;

    /* Radii */
    --kcb-radius-sm: 8px;
    --kcb-radius-md: 12px;
    --kcb-radius-lg: 20px;
    --kcb-radius-full: 9999px;

    /* Animation */
    --kcb-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    --kcb-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
    --kcb-duration-fast: 150ms;
    --kcb-duration-normal: 250ms;
    --kcb-duration-slow: 400ms;

    all: initial;
    font-family: var(--kcb-font-sans);
    font-size: 15px;
    line-height: 1.5;
    color: var(--kcb-text-primary);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  /* Container */
  .kcb-container {
    position: fixed;
    bottom: var(--kcb-space-lg);
    right: var(--kcb-space-lg);
    z-index: 2147483647;
    font-family: var(--kcb-font-sans);
  }

  .kcb-container.left {
    right: auto;
    left: var(--kcb-space-lg);
  }

  /* Launcher Button - Base Styles */
  .kcb-launcher {
    border: none;
    background: var(--kcb-accent);
    color: var(--kcb-text-inverse);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--kcb-space-sm);
    box-shadow: var(--kcb-shadow-lg);
    transition:
      transform var(--kcb-duration-normal) var(--kcb-ease-out),
      box-shadow var(--kcb-duration-normal) var(--kcb-ease-out),
      background var(--kcb-duration-fast);
    position: relative;
    overflow: hidden;
    font-family: var(--kcb-font-sans);
    font-weight: 500;
  }

  .kcb-launcher::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 50%);
    opacity: 0;
    transition: opacity var(--kcb-duration-fast);
  }

  .kcb-launcher:hover {
    transform: scale(1.05);
    box-shadow: var(--kcb-shadow-xl);
    background: var(--kcb-accent-hover);
  }

  .kcb-launcher:hover::before {
    opacity: 1;
  }

  .kcb-launcher:active {
    transform: scale(0.98);
  }

  .kcb-launcher svg {
    transition: transform var(--kcb-duration-normal) var(--kcb-ease-out);
    flex-shrink: 0;
  }

  .kcb-launcher.open {
    opacity: 0;
    pointer-events: none;
    transform: scale(0.8);
  }

  .kcb-launcher.open svg {
    transform: rotate(90deg) scale(0.9);
  }

  /* Button text for pill style */
  .kcb-launcher-text {
    white-space: nowrap;
  }

  /* Custom icon image */
  .kcb-launcher-custom-icon {
    width: 24px;
    height: 24px;
    object-fit: contain;
    flex-shrink: 0;
    transition: transform var(--kcb-duration-normal) var(--kcb-ease-out);
  }

  .kcb-launcher--small .kcb-launcher-custom-icon {
    width: 20px;
    height: 20px;
  }

  .kcb-launcher--large .kcb-launcher-custom-icon {
    width: 28px;
    height: 28px;
  }

  /* Button Style: Circle (default) */
  .kcb-launcher--circle {
    border-radius: var(--kcb-radius-full);
  }

  /* Button Style: Pill */
  .kcb-launcher--pill {
    border-radius: var(--kcb-radius-full);
    padding-left: var(--kcb-space-md);
    padding-right: var(--kcb-space-lg);
  }

  /* Button Style: Square */
  .kcb-launcher--square {
    border-radius: var(--kcb-radius-md);
  }

  /* Button Size: Small */
  .kcb-launcher--small {
    height: 44px;
    font-size: 13px;
  }
  .kcb-launcher--small.kcb-launcher--circle,
  .kcb-launcher--small.kcb-launcher--square {
    width: 44px;
  }
  .kcb-launcher--small svg {
    width: 20px;
    height: 20px;
  }

  /* Button Size: Medium (default) */
  .kcb-launcher--medium {
    height: 56px;
    font-size: 15px;
  }
  .kcb-launcher--medium.kcb-launcher--circle,
  .kcb-launcher--medium.kcb-launcher--square {
    width: 56px;
  }
  .kcb-launcher--medium svg {
    width: 24px;
    height: 24px;
  }

  /* Button Size: Large */
  .kcb-launcher--large {
    height: 64px;
    font-size: 16px;
  }
  .kcb-launcher--large.kcb-launcher--circle,
  .kcb-launcher--large.kcb-launcher--square {
    width: 64px;
  }
  .kcb-launcher--large svg {
    width: 28px;
    height: 28px;
  }

  /* Pill adjustments for sizes */
  .kcb-launcher--pill.kcb-launcher--small {
    padding-left: 12px;
    padding-right: 16px;
  }
  .kcb-launcher--pill.kcb-launcher--medium {
    padding-left: 16px;
    padding-right: 20px;
  }
  .kcb-launcher--pill.kcb-launcher--large {
    padding-left: 20px;
    padding-right: 24px;
  }

  /* Chat Window */
  .kcb-window {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 400px;
    height: min(600px, calc(100vh - 48px));
    background: var(--kcb-bg-primary);
    border-radius: var(--kcb-radius-lg);
    box-shadow: var(--kcb-shadow-xl);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    opacity: 0;
    transform: translateY(16px) scale(0.96);
    transform-origin: bottom right;
    pointer-events: none;
    transition:
      opacity var(--kcb-duration-slow) var(--kcb-ease-out),
      transform var(--kcb-duration-slow) var(--kcb-ease-out);
  }

  .kcb-container.left .kcb-window {
    right: auto;
    left: 0;
    transform-origin: bottom left;
  }

  .kcb-window.open {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }

  .kcb-window.expanded {
    width: 650px;
    height: min(900px, calc(100vh - 60px));
  }

  /* Header */
  .kcb-header {
    padding: var(--kcb-space-md) var(--kcb-space-lg);
    background: var(--kcb-bg-elevated);
    border-bottom: 1px solid var(--kcb-border-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: relative;
    z-index: 1;
  }

  .kcb-header-left {
    display: flex;
    align-items: center;
    gap: var(--kcb-space-sm);
  }

  .kcb-header-logo {
    width: 32px;
    height: 32px;
    border-radius: var(--kcb-radius-sm);
    object-fit: cover;
  }

  .kcb-header-title {
    font-family: var(--kcb-font-sans);
    font-size: 17px;
    font-weight: 600;
    color: var(--kcb-text-primary);
    letter-spacing: -0.01em;
  }

  .kcb-header-actions {
    display: flex;
    align-items: center;
    gap: var(--kcb-space-xs);
  }

  .kcb-header-btn {
    width: 32px;
    height: 32px;
    border-radius: var(--kcb-radius-sm);
    border: none;
    background: transparent;
    color: var(--kcb-text-tertiary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background var(--kcb-duration-fast),
      color var(--kcb-duration-fast);
  }

  .kcb-header-btn:hover {
    background: var(--kcb-bg-secondary);
    color: var(--kcb-text-primary);
  }

  .kcb-header-btn svg {
    width: 18px;
    height: 18px;
  }

  /* Messages Area */
  .kcb-messages {
    flex: 1;
    overflow-y: auto;
    padding: var(--kcb-space-lg);
    display: flex;
    flex-direction: column;
    gap: var(--kcb-space-md);
    position: relative;
    z-index: 1;
    scroll-behavior: smooth;
  }

  .kcb-messages::-webkit-scrollbar {
    width: 6px;
  }

  .kcb-messages::-webkit-scrollbar-track {
    background: transparent;
  }

  .kcb-messages::-webkit-scrollbar-thumb {
    background: var(--kcb-border);
    border-radius: var(--kcb-radius-full);
  }

  /* Empty State */
  .kcb-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: var(--kcb-space-xl);
    color: var(--kcb-text-secondary);
  }

  .kcb-empty-icon {
    width: 48px;
    height: 48px;
    margin-bottom: var(--kcb-space-md);
    color: var(--kcb-accent);
    opacity: 0.6;
  }

  .kcb-empty-title {
    font-family: var(--kcb-font-sans);
    font-size: 17px;
    font-weight: 600;
    color: var(--kcb-text-primary);
    margin-bottom: var(--kcb-space-xs);
  }

  .kcb-empty-text {
    font-size: 14px;
    color: var(--kcb-text-tertiary);
    max-width: 260px;
  }

  /* Message Bubble */
  .kcb-message {
    max-width: 85%;
    animation: kcb-message-in var(--kcb-duration-slow) var(--kcb-ease-out) forwards;
    opacity: 0;
    transform: translateY(8px);
  }

  @keyframes kcb-message-in {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .kcb-message.user {
    align-self: flex-end;
  }

  .kcb-message.assistant {
    align-self: flex-start;
  }

  .kcb-message-bubble {
    padding: var(--kcb-space-sm) var(--kcb-space-md);
    border-radius: var(--kcb-radius-md);
    font-size: 15px;
    line-height: 1.55;
  }

  .kcb-message.user .kcb-message-bubble {
    background: var(--kcb-accent);
    color: var(--kcb-text-inverse);
    border-bottom-right-radius: var(--kcb-space-xs);
  }

  .kcb-message.assistant .kcb-message-bubble {
    background: var(--kcb-bg-elevated);
    color: var(--kcb-text-primary);
    border: 1px solid var(--kcb-border);
    border-bottom-left-radius: var(--kcb-space-xs);
  }

  /* Message Content Formatting */
  .kcb-message-bubble p {
    margin: 0 0 var(--kcb-space-sm) 0;
  }

  .kcb-message-bubble p:last-child {
    margin-bottom: 0;
  }

  .kcb-message-bubble strong {
    font-weight: 600;
  }

  .kcb-message-bubble em {
    font-style: italic;
  }

  .kcb-message-bubble code {
    font-family: var(--kcb-font-mono);
    font-size: 13px;
    background: var(--kcb-bg-tertiary);
    padding: 2px 6px;
    border-radius: 4px;
  }

  .kcb-message.user .kcb-message-bubble code {
    background: rgba(255,255,255,0.2);
  }

  .kcb-message-bubble pre {
    background: #1E293B;
    color: #E2E8F0;
    padding: var(--kcb-space-sm) var(--kcb-space-md);
    border-radius: var(--kcb-radius-sm);
    overflow-x: auto;
    margin: var(--kcb-space-sm) 0;
    font-family: var(--kcb-font-mono);
    font-size: 13px;
    line-height: 1.5;
  }

  .kcb-message-bubble pre code {
    background: none;
    padding: 0;
    border-radius: 0;
    color: inherit;
    font-family: inherit;
  }

  .kcb-message-bubble a {
    color: var(--kcb-accent);
    text-decoration: none;
    border-bottom: 1px solid currentColor;
    transition: opacity var(--kcb-duration-fast);
  }

  .kcb-message-bubble a:hover {
    opacity: 0.7;
  }

  /* Lists */
  .kcb-message-bubble ol,
  .kcb-message-bubble ul {
    margin: var(--kcb-space-sm) 0;
    padding-left: var(--kcb-space-lg);
  }

  .kcb-message-bubble ol {
    list-style-type: decimal;
  }

  .kcb-message-bubble ul {
    list-style-type: disc;
  }

  .kcb-message-bubble li {
    margin-bottom: var(--kcb-space-xs);
    line-height: 1.5;
  }

  .kcb-message-bubble li:last-child {
    margin-bottom: 0;
  }

  /* Headings */
  .kcb-message-bubble h1,
  .kcb-message-bubble h2,
  .kcb-message-bubble h3,
  .kcb-message-bubble h4,
  .kcb-message-bubble h5,
  .kcb-message-bubble h6 {
    font-family: var(--kcb-font-sans);
    font-weight: 600;
    line-height: 1.3;
    margin: var(--kcb-space-md) 0 var(--kcb-space-sm) 0;
    color: var(--kcb-text-primary);
  }

  .kcb-message-bubble h1:first-child,
  .kcb-message-bubble h2:first-child,
  .kcb-message-bubble h3:first-child {
    margin-top: 0;
  }

  .kcb-message-bubble h1 { font-size: 1.5em; }
  .kcb-message-bubble h2 { font-size: 1.3em; }
  .kcb-message-bubble h3 { font-size: 1.15em; }
  .kcb-message-bubble h4 { font-size: 1.05em; }
  .kcb-message-bubble h5 { font-size: 1em; }
  .kcb-message-bubble h6 { font-size: 0.95em; color: var(--kcb-text-secondary); }

  /* Blockquotes */
  .kcb-message-bubble blockquote {
    margin: var(--kcb-space-sm) 0;
    padding: var(--kcb-space-sm) var(--kcb-space-md);
    border-left: 3px solid var(--kcb-accent);
    background: var(--kcb-bg-secondary);
    border-radius: 0 var(--kcb-radius-sm) var(--kcb-radius-sm) 0;
    color: var(--kcb-text-secondary);
    font-style: italic;
  }

  .kcb-message-bubble blockquote p {
    margin: 0;
  }

  /* Horizontal Rule */
  .kcb-message-bubble hr {
    border: none;
    border-top: 1px solid var(--kcb-border);
    margin: var(--kcb-space-md) 0;
  }

  /* Tables */
  .kcb-message-bubble table {
    width: 100%;
    border-collapse: collapse;
    margin: var(--kcb-space-sm) 0;
    font-size: 13px;
  }

  .kcb-message-bubble th,
  .kcb-message-bubble td {
    padding: var(--kcb-space-xs) var(--kcb-space-sm);
    text-align: left;
    border: 1px solid var(--kcb-border);
  }

  .kcb-message-bubble th {
    background: var(--kcb-bg-secondary);
    font-weight: 600;
    color: var(--kcb-text-primary);
  }

  .kcb-message-bubble td {
    background: var(--kcb-bg-elevated);
  }

  .kcb-message-bubble tr:nth-child(even) td {
    background: var(--kcb-bg-primary);
  }

  /* Streaming Cursor */
  .kcb-cursor {
    display: inline-block;
    width: 2px;
    height: 1em;
    background: var(--kcb-accent);
    margin-left: 2px;
    animation: kcb-blink 1s ease-in-out infinite;
    vertical-align: text-bottom;
  }

  @keyframes kcb-blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  }

  /* Sources */
  .kcb-sources {
    margin-top: var(--kcb-space-sm);
  }

  .kcb-sources-trigger {
    display: flex;
    align-items: center;
    gap: var(--kcb-space-xs);
    padding: var(--kcb-space-xs) var(--kcb-space-sm);
    background: var(--kcb-accent-subtle);
    border: none;
    border-radius: var(--kcb-radius-sm);
    font-family: var(--kcb-font-sans);
    font-size: 12px;
    font-weight: 500;
    color: var(--kcb-accent);
    cursor: pointer;
    transition: background var(--kcb-duration-fast), color var(--kcb-duration-fast);
  }

  .kcb-sources-trigger:hover {
    background: var(--kcb-accent);
    color: var(--kcb-text-inverse);
  }

  .kcb-sources-trigger svg {
    width: 12px;
    height: 12px;
    transition: transform var(--kcb-duration-fast);
  }

  .kcb-sources-trigger.open svg {
    transform: rotate(180deg);
  }

  .kcb-sources-list {
    display: none;
    margin-top: var(--kcb-space-sm);
    padding: var(--kcb-space-sm);
    background: var(--kcb-bg-secondary);
    border-radius: var(--kcb-radius-sm);
  }

  .kcb-sources-list.open {
    display: block;
    animation: kcb-fade-in var(--kcb-duration-fast) var(--kcb-ease-out);
  }

  @keyframes kcb-fade-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .kcb-source {
    display: flex;
    align-items: flex-start;
    gap: var(--kcb-space-sm);
    padding: var(--kcb-space-xs) 0;
    text-decoration: none;
    color: var(--kcb-text-secondary);
    font-size: 13px;
    transition: color var(--kcb-duration-fast);
  }

  .kcb-source:hover {
    color: var(--kcb-accent);
  }

  .kcb-source svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .kcb-source-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Typing Indicator - Centered in message area */
  .kcb-typing {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: var(--kcb-space-lg);
    flex: 1;
    min-height: 100px;
  }

  .kcb-typing-dot {
    width: 8px;
    height: 8px;
    background: var(--kcb-accent);
    border-radius: 50%;
    animation: kcb-typing 1.4s ease-in-out infinite;
  }

  .kcb-typing-dot:nth-child(1) { animation-delay: 0s; }
  .kcb-typing-dot:nth-child(2) { animation-delay: 0.2s; }
  .kcb-typing-dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes kcb-typing {
    0%, 60%, 100% {
      transform: translateY(0);
      opacity: 0.4;
    }
    30% {
      transform: translateY(-6px);
      opacity: 1;
    }
  }

  /* Input Area */
  .kcb-input-area {
    padding: var(--kcb-space-md) var(--kcb-space-lg);
    background: var(--kcb-bg-elevated);
    border-top: 1px solid var(--kcb-border-subtle);
    position: relative;
    z-index: 1;
  }

  .kcb-input-container {
    display: flex;
    align-items: center;
    gap: var(--kcb-space-sm);
    background: var(--kcb-bg-secondary);
    border-radius: var(--kcb-radius-md);
    padding: var(--kcb-space-sm);
    transition: box-shadow var(--kcb-duration-fast);
  }

  .kcb-input-container:focus-within {
    box-shadow: 0 0 0 2px var(--kcb-accent);
  }

  .kcb-input {
    flex: 1;
    border: none;
    background: transparent;
    font-family: var(--kcb-font-sans);
    font-size: 15px;
    line-height: 1.4;
    color: var(--kcb-text-primary);
    resize: none;
    outline: none;
    min-height: 36px;
    max-height: 120px;
    padding: 8px 4px;
    display: flex;
    align-items: center;
  }

  .kcb-input::placeholder {
    color: var(--kcb-text-tertiary);
  }

  .kcb-send {
    width: 36px;
    height: 36px;
    border-radius: var(--kcb-radius-sm);
    border: none;
    background: var(--kcb-accent);
    color: var(--kcb-text-inverse);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition:
      background var(--kcb-duration-fast),
      transform var(--kcb-duration-fast);
  }

  .kcb-send:hover:not(:disabled) {
    background: var(--kcb-accent-hover);
  }

  .kcb-send:active:not(:disabled) {
    transform: scale(0.95);
  }

  .kcb-send:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .kcb-send svg {
    width: 18px;
    height: 18px;
  }

  /* Footer */
  .kcb-footer {
    padding: var(--kcb-space-sm) var(--kcb-space-lg);
    text-align: center;
    font-size: 11px;
    color: var(--kcb-text-tertiary);
    background: var(--kcb-bg-elevated);
    border-top: 1px solid var(--kcb-border-subtle);
  }

  .kcb-footer a {
    color: inherit;
    text-decoration: none;
    opacity: 0.8;
    transition: opacity var(--kcb-duration-fast);
  }

  .kcb-footer a:hover {
    opacity: 1;
  }

  /* Mobile Responsive */
  @media (max-width: 480px) {
    .kcb-container {
      bottom: var(--kcb-space-md);
      right: var(--kcb-space-md);
    }

    .kcb-container.left {
      left: var(--kcb-space-md);
    }

    .kcb-window {
      width: calc(100vw - var(--kcb-space-xl));
      height: calc(100vh - 32px);
      max-height: none;
      bottom: 0;
    }

    .kcb-window.expanded {
      width: calc(100vw - var(--kcb-space-xl));
      height: calc(100vh - 32px);
    }

    .kcb-launcher {
      width: 52px;
      height: 52px;
    }
  }

  /* Tablet breakpoint for expanded */
  @media (min-width: 481px) and (max-width: 768px) {
    .kcb-window.expanded {
      width: min(580px, calc(100vw - 60px));
      height: min(800px, calc(100vh - 60px));
    }
  }
`;

export default styles;
