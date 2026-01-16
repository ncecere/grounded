import { render } from 'preact';
import { FullPageChat, type FullPageChatConfig } from './components/FullPageChat';
import { createShadowDOM, type ColorScheme, type ShadowDOMContext } from './lib/shadow-dom';

// ============================================================================
// Published Chat - Full page chat interface with Shadow DOM
// ============================================================================

interface PublishedChatOptions extends FullPageChatConfig {
  colorScheme?: ColorScheme;
}

class PublishedChatManager {
  private context: ShadowDOMContext | null = null;
  private mounted = false;

  init(config: PublishedChatOptions) {
    if (this.mounted) {
      console.warn('[Grounded Chat] Already initialized');
      return;
    }

    if (!config?.token) {
      console.error('[Grounded Chat] Token is required');
      return;
    }

    const colorScheme = config.colorScheme || 'auto';

    // Create Shadow DOM container using shared utility
    this.context = createShadowDOM({
      containerId: 'grounded-chat-container',
      containerStyle: 'position:fixed;inset:0;z-index:2147483647;',
      colorScheme,
    });

    // Render the chat into the shadow mount point
    render(<FullPageChat config={config} />, this.context.mountPoint);
    
    this.mounted = true;
    console.log('[Grounded Chat] Initialized with colorScheme:', colorScheme);
  }

  destroy() {
    if (this.context) {
      this.context.cleanup();
      this.context = null;
    }
    this.mounted = false;
    console.log('[Grounded Chat] Destroyed');
  }
}

// ============================================================================
// Global API
// ============================================================================

const manager = new PublishedChatManager();

function groundedChat(command: string, payload?: any) {
  if (command === 'init') {
    manager.init(payload);
  } else if (command === 'destroy') {
    manager.destroy();
  }
}

// Process queue
const queue = (window as any).groundedChat?.q || [];
for (const args of queue) {
  groundedChat(args[0], args[1]);
}

// Replace queue with actual function
(window as any).groundedChat = groundedChat;

export { groundedChat };
