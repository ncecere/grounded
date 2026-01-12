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
}

export interface WidgetConfig {
  agentName: string;
  description?: string;
  welcomeMessage?: string;
  logoUrl?: string | null;
  theme?: WidgetTheme;
  isPublic: boolean;
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

export interface WidgetOptions {
  token: string;
  apiBase?: string;
  position?: 'bottom-right' | 'bottom-left';
}
