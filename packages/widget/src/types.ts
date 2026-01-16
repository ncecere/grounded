export type ButtonStyle = 'circle' | 'pill' | 'square';
export type ButtonSize = 'small' | 'medium' | 'large';
export type ButtonIcon = 'chat' | 'help' | 'question' | 'message';

export interface WidgetTheme {
  primaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  buttonPosition?: 'bottom-right' | 'bottom-left';
  borderRadius?: number;
  buttonStyle?: ButtonStyle;
  buttonSize?: ButtonSize;
  buttonText?: string;
  buttonIcon?: ButtonIcon;
  buttonColor?: string;
  customIconUrl?: string | null;
  customIconSize?: number; // Icon size in pixels (default based on button size)
}

export interface AgenticModeConfig {
  enabled: boolean;
  showChainOfThought: boolean;
}

export interface WidgetConfig {
  agentName: string;
  description?: string;
  welcomeMessage?: string;
  logoUrl?: string | null;
  theme?: WidgetTheme;
  isPublic: boolean;
  agenticMode?: AgenticModeConfig;
}

// Chain of thought types
export interface ChainOfThoughtStep {
  type: 'thinking' | 'searching' | 'tool_call' | 'tool_result' | 'answering';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  kbId?: string;
  kbName?: string;
  timestamp: number;
}

export interface Citation {
  index: number; // The citation number (1, 2, 3, etc.) as used in the text
  title: string | null;
  url: string | null;
  snippet?: string;
  chunkId?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  timestamp: number;
  isStreaming?: boolean;
  chainOfThought?: ChainOfThoughtStep[];
}

export interface WidgetState {
  isOpen: boolean;
  isLoading: boolean;
  isStreaming: boolean;
  messages: ChatMessage[];
  conversationId: string | null;
  config: WidgetConfig | null;
  error: string | null;
}

export type WidgetColorScheme = 'light' | 'dark' | 'auto';

export interface WidgetOptions {
  token: string;
  apiBase?: string;
  position?: 'bottom-right' | 'bottom-left';
  /**
   * Color scheme for the widget.
   * - 'light': Always use light theme
   * - 'dark': Always use dark theme
   * - 'auto': Detect from system preference (default)
   */
  colorScheme?: WidgetColorScheme;
}
