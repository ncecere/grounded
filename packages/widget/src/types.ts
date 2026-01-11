export interface WidgetConfig {
  agentName: string;
  description?: string;
  welcomeMessage?: string;
  logoUrl?: string | null;
  theme?: Record<string, unknown>;
  isPublic: boolean;
}

export interface Citation {
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
