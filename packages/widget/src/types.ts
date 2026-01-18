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
  reasoningSteps?: ReasoningStep[];
}

// =============================================================================
// Reasoning Types (for Advanced RAG)
// =============================================================================

/**
 * Types of reasoning steps in the advanced RAG pipeline
 */
export type ReasoningStepType = 'rewrite' | 'plan' | 'search' | 'merge' | 'generate';

/**
 * Status of a reasoning step
 */
export type ReasoningStepStatus = 'pending' | 'in_progress' | 'completed' | 'error';

/**
 * Represents a single step in the advanced RAG reasoning process.
 * Each step provides visibility into what the AI is doing to answer the query.
 */
export interface ReasoningStep {
  /** Unique identifier for the step */
  id: string;
  /** Type of reasoning step */
  type: ReasoningStepType;
  /** Human-readable title for the step */
  title: string;
  /** Summary of what the step is doing or has done */
  summary: string;
  /** Current status of the step */
  status: ReasoningStepStatus;
  /** Optional additional details about the step (e.g., sub-queries generated) */
  details?: Record<string, unknown>;
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
