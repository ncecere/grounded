import { useState, useRef, useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import { useChat } from '../hooks/useChat';
import { Message, StatusIndicator } from './Message';
import { SendIcon, SparklesIcon } from './Icons';

export interface FullPageChatConfig {
  token: string;
  apiBase: string;
  agentName: string;
  welcomeMessage: string;
  logoUrl?: string | null;
}

interface FullPageChatProps {
  config: FullPageChatConfig;
}

export function FullPageChat({ config }: FullPageChatProps): JSX.Element {
  const { token, apiBase, agentName, welcomeMessage, logoUrl } = config;
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, isLoading, chatStatus, sendMessage } = useChat({
    token,
    apiBase,
    endpointType: 'chat-endpoint',
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Refocus input after response
  const wasLoadingRef = useRef(false);
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading]);

  const handleSubmit = () => {
    if (inputValue.trim() && !isLoading) {
      sendMessage(inputValue);
      setInputValue('');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    setInputValue(target.value);
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 120) + 'px';
  };

  const showEmptyState = messages.length === 0 && !isLoading;
  const agentInitial = agentName.charAt(0).toUpperCase();

  return (
    <div className="grounded-fullpage">
      {/* Header */}
      <div className="grounded-fullpage-header">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="grounded-fullpage-logo" />
        ) : (
          <div className="grounded-fullpage-avatar">{agentInitial}</div>
        )}
        <div className="grounded-fullpage-info">
          <h1>{agentName}</h1>
        </div>
      </div>

      {/* Messages */}
      <div className="grounded-fullpage-messages">
        <div className="grounded-fullpage-messages-inner">
          {showEmptyState ? (
            <div className="grounded-fullpage-welcome">
              <SparklesIcon className="grounded-fullpage-welcome-icon" />
              <h2>{welcomeMessage}</h2>
              <p>Ask me anything. I'm here to help.</p>
            </div>
          ) : (
            <>
              {messages.filter(m => m.content || m.role === 'user').map((message) => (
                <Message key={message.id} message={message} />
              ))}
              
              {(isLoading || chatStatus.status !== 'idle') && chatStatus.status !== 'streaming' && (
                <StatusIndicator status={chatStatus} />
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="grounded-fullpage-input-area">
        <div className="grounded-fullpage-input-container">
          <textarea
            ref={inputRef}
            className="grounded-fullpage-input"
            placeholder={`Ask ${agentName} anything...`}
            value={inputValue}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isLoading}
          />
          <button
            className="grounded-fullpage-send"
            onClick={handleSubmit}
            disabled={!inputValue.trim() || isLoading}
            aria-label="Send message"
          >
            <SendIcon />
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="grounded-fullpage-footer">
        Powered by <a href="https://github.com/grounded-ai" target="_blank" rel="noopener noreferrer">Grounded</a>
      </div>
    </div>
  );
}
