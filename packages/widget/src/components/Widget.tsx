import { useState, useRef, useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import { useChat } from '../hooks/useChat';
import { useConfig } from '../hooks/useConfig';
import { Message, TypingIndicator } from './Message';
import { ChatIcon, CloseIcon, SendIcon, SparklesIcon, ExpandIcon, ShrinkIcon } from './Icons';
import type { WidgetOptions } from '../types';

interface WidgetProps {
  options: WidgetOptions;
  initialOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Widget({ options, initialOpen = false, onOpenChange }: WidgetProps): JSX.Element {
  const { token, apiBase = '', position = 'bottom-right' } = options;
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [isExpanded, setIsExpanded] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { config, isLoading: configLoading } = useConfig({ token, apiBase });
  const { messages, isLoading, sendMessage } = useChat({ token, apiBase });

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Notify parent of open state changes
  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  const handleSubmit = () => {
    if (inputValue.trim() && !isLoading) {
      sendMessage(inputValue);
      setInputValue('');
      // Reset textarea height and refocus after a tick
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }
      // Refocus with delay to ensure state updates complete
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
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
    // Auto-resize textarea
    target.style.height = 'auto';
    target.style.height = Math.min(target.scrollHeight, 120) + 'px';
  };

  const isLeft = position === 'bottom-left';
  const agentName = config?.agentName || 'Assistant';
  const welcomeMessage = config?.welcomeMessage || 'How can I help?';
  const description = config?.description || "Ask me anything. I'm here to assist you.";
  const logoUrl = config?.logoUrl;
  const showEmptyState = messages.length === 0 && !isLoading;

  return (
    <div className={`kcb-container ${isLeft ? 'left' : ''}`}>
      {/* Chat Window */}
      <div className={`kcb-window ${isOpen ? 'open' : ''} ${isExpanded ? 'expanded' : ''}`}>
        {/* Header */}
        <div className="kcb-header">
          <div className="kcb-header-left">
            {logoUrl && (
              <img src={logoUrl} alt="" className="kcb-header-logo" />
            )}
            <h2 className="kcb-header-title">{agentName}</h2>
          </div>
          <div className="kcb-header-actions">
            <button
              className="kcb-header-btn"
              onClick={() => setIsExpanded(!isExpanded)}
              aria-label={isExpanded ? 'Shrink chat' : 'Expand chat'}
            >
              {isExpanded ? <ShrinkIcon /> : <ExpandIcon />}
            </button>
            <button
              className="kcb-header-btn"
              onClick={handleToggle}
              aria-label="Close chat"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="kcb-messages">
          {showEmptyState ? (
            <div className="kcb-empty">
              <SparklesIcon className="kcb-empty-icon" />
              <h3 className="kcb-empty-title">{description}</h3>
              <p className="kcb-empty-text">
                {welcomeMessage}
              </p>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <Message key={message.id} message={message} />
              ))}
              {isLoading && <TypingIndicator />}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="kcb-input-area">
          <div className="kcb-input-container">
            <textarea
              ref={inputRef}
              className="kcb-input"
              placeholder="Type a message..."
              value={inputValue}
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={isLoading}
            />
            <button
              className="kcb-send"
              onClick={handleSubmit}
              disabled={!inputValue.trim() || isLoading}
              aria-label="Send message"
            >
              <SendIcon />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="kcb-footer">
          Powered by <a href="https://kcb.ai" target="_blank" rel="noopener">KCB</a>
        </div>
      </div>

      {/* Launcher Button */}
      <button
        className={`kcb-launcher ${isOpen ? 'open' : ''}`}
        onClick={handleToggle}
        aria-label={isOpen ? 'Close chat' : 'Open chat'}
      >
        {isOpen ? <CloseIcon /> : <ChatIcon />}
      </button>
    </div>
  );
}
