import { useState, useRef, useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import { useChat, type ChatStatus } from '../hooks/useChat';
import { useConfig } from '../hooks/useConfig';
import { Message, StatusIndicator } from './Message';
import { ChatIcon, CloseIcon, SendIcon, SparklesIcon, ExpandIcon, ShrinkIcon, HelpIcon, QuestionIcon, MessageIcon } from './Icons';
import { AgenticSteps, AgenticStatus } from './AgenticSteps';
import type { WidgetOptions, ButtonIcon, ButtonStyle, ButtonSize } from '../types';

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
  
  // Check if agentic mode is enabled from config
  const agenticMode = config?.agenticMode?.enabled ?? false;
  const showChainOfThought = config?.agenticMode?.showChainOfThought ?? false;
  
  const { messages, isLoading, chatStatus, chainOfThoughtSteps, sendMessage } = useChat({ 
    token, 
    apiBase,
    agenticMode,
    showChainOfThought,
  });

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

  // Refocus input after response is received (isLoading goes from true to false)
  const wasLoadingRef = useRef(false);
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading && isOpen) {
      // Response just finished, refocus input
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading, isOpen]);

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

  // Button customization from theme
  const buttonStyle: ButtonStyle = config?.theme?.buttonStyle || 'circle';
  const buttonSize: ButtonSize = config?.theme?.buttonSize || 'medium';
  const buttonText = config?.theme?.buttonText || 'Chat with us';
  const buttonIcon: ButtonIcon = config?.theme?.buttonIcon || 'chat';
  const buttonColor = config?.theme?.buttonColor || '#2563eb';
  const customIconUrl = config?.theme?.customIconUrl;
  const customIconSize = config?.theme?.customIconSize;

  // Get the appropriate icon component or custom image
  const getButtonIcon = () => {
    if (customIconUrl) {
      // Use CSS custom property for size override, which works better with CSS specificity
      const iconStyle = customIconSize
        ? { '--custom-icon-size': `${customIconSize}px` } as JSX.CSSProperties
        : undefined;
      return <img src={customIconUrl} alt="" className="grounded-launcher-custom-icon" style={iconStyle} />;
    }
    switch (buttonIcon) {
      case 'help': return <HelpIcon />;
      case 'question': return <QuestionIcon />;
      case 'message': return <MessageIcon />;
      case 'chat':
      default: return <ChatIcon />;
    }
  };

  return (
    <div className={`grounded-container ${isLeft ? 'left' : ''}`}>
      {/* Chat Window */}
      <div className={`grounded-window ${isOpen ? 'open' : ''} ${isExpanded ? 'expanded' : ''}`}>
        {/* Header */}
        <div className="grounded-header">
          <div className="grounded-header-left">
            {logoUrl && (
              <img src={logoUrl} alt="" className="grounded-header-logo" />
            )}
            <h2 className="grounded-header-title">{agentName}</h2>
          </div>
          <div className="grounded-header-actions">
            <button
              className="grounded-header-btn"
              onClick={() => setIsExpanded(!isExpanded)}
              aria-label={isExpanded ? 'Shrink chat' : 'Expand chat'}
            >
              {isExpanded ? <ShrinkIcon /> : <ExpandIcon />}
            </button>
            <button
              className="grounded-header-btn"
              onClick={handleToggle}
              aria-label="Close chat"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="grounded-messages">
          {showEmptyState ? (
            <div className="grounded-empty">
              <SparklesIcon className="grounded-empty-icon" />
              <h3 className="grounded-empty-title">{description}</h3>
              <p className="grounded-empty-text">
                {welcomeMessage}
              </p>
            </div>
          ) : (
            <>
              {(() => {
                const filteredMessages = messages.filter(m => m.content || m.role === 'user');
                const hasAgenticSteps = agenticMode && showChainOfThought && chainOfThoughtSteps.length > 0;
                // Only show chain of thought while streaming/loading, not after completion
                const isAgenticActive = isLoading || chatStatus.status !== 'idle';
                
                // Find the last assistant message index that follows a user message
                // (not the welcome message which has no user message before it)
                let lastAssistantIndex = -1;
                let hasUserMessage = false;
                for (let i = 0; i < filteredMessages.length; i++) {
                  if (filteredMessages[i].role === 'user') {
                    hasUserMessage = true;
                  } else if (filteredMessages[i].role === 'assistant' && hasUserMessage) {
                    lastAssistantIndex = i;
                  }
                }
                
                return filteredMessages.map((message, index) => {
                  // Show chain of thought ABOVE the last assistant message that follows a user message (only while active)
                  const showChainOfThoughtHere = hasAgenticSteps && 
                    isAgenticActive &&
                    index === lastAssistantIndex && 
                    message.role === 'assistant';
                  
                  return (
                    <div key={message.id}>
                      {showChainOfThoughtHere && (
                        <AgenticSteps 
                          steps={chainOfThoughtSteps} 
                          status={chatStatus} 
                          isStreaming={isLoading || (chatStatus.status !== 'idle' && chatStatus.status !== 'streaming')}
                        />
                      )}
                      <Message message={message} />
                    </div>
                  );
                });
              })()}
              
              {/* Show chain of thought when waiting for response (before assistant message exists) */}
              {agenticMode && showChainOfThought && chainOfThoughtSteps.length > 0 && 
               (isLoading || chatStatus.status !== 'idle') && 
               messages[messages.length - 1]?.role !== 'assistant' && (
                <AgenticSteps 
                  steps={chainOfThoughtSteps} 
                  status={chatStatus} 
                  isStreaming={true}
                />
              )}
              
              {/* Show compact status indicator when chain of thought is not shown */}
              {(isLoading || chatStatus.status !== 'idle') && chatStatus.status !== 'streaming' && 
               !(agenticMode && showChainOfThought && chainOfThoughtSteps.length > 0) && (
                agenticMode ? (
                  <AgenticStatus status={chatStatus} />
                ) : (
                  <StatusIndicator status={chatStatus} />
                )
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="grounded-input-area">
          <div className="grounded-input-container">
            <textarea
              ref={inputRef}
              className="grounded-input"
              placeholder="Type a message..."
              value={inputValue}
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={isLoading}
            />
            <button
              className="grounded-send"
              onClick={handleSubmit}
              disabled={!inputValue.trim() || isLoading}
              aria-label="Send message"
            >
              <SendIcon />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="grounded-footer">
          Powered by <a href="https://grounded.ai" target="_blank" rel="noopener">Grounded</a>
        </div>
      </div>

      {/* Launcher Button */}
      <button
        className={`grounded-launcher grounded-launcher--${buttonStyle} grounded-launcher--${buttonSize} ${isOpen ? 'open' : ''}`}
        onClick={handleToggle}
        aria-label={isOpen ? 'Close chat' : 'Open chat'}
        style={{ backgroundColor: buttonColor }}
      >
        {isOpen ? (
          <CloseIcon />
        ) : (
          <>
            {getButtonIcon()}
            {buttonStyle === 'pill' && <span className="grounded-launcher-text">{buttonText}</span>}
          </>
        )}
      </button>
    </div>
  );
}
