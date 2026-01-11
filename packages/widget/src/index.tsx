import { render } from 'preact';
import { Widget } from './components/Widget';
import styles from './styles';
import type { WidgetOptions } from './types';

// ============================================================================
// Widget Manager - Handles initialization and API
// ============================================================================

class KCBWidgetManager {
  private container: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private options: WidgetOptions | null = null;
  private isInitialized = false;
  private openState = false;
  private openCallback: ((open: boolean) => void) | null = null;

  constructor() {
    // Process any queued commands
    this.processQueue();
  }

  private processQueue() {
    const queue = (window as any).kcb?.q || [];
    for (const args of queue) {
      this.handleCommand(args[0], args[1]);
    }
  }

  handleCommand(command: string, payload?: any) {
    switch (command) {
      case 'init':
        this.init(payload);
        break;
      case 'open':
        this.open();
        break;
      case 'close':
        this.close();
        break;
      case 'toggle':
        this.toggle();
        break;
      case 'destroy':
        this.destroy();
        break;
      default:
        console.warn(`[KCB Widget] Unknown command: ${command}`);
    }
  }

  private init(options: WidgetOptions) {
    if (this.isInitialized) {
      console.warn('[KCB Widget] Already initialized');
      return;
    }

    if (!options?.token) {
      console.error('[KCB Widget] Token is required');
      return;
    }

    this.options = {
      ...options,
      apiBase: options.apiBase || this.detectApiBase(),
    };

    // Create container
    this.container = document.createElement('div');
    this.container.id = 'kcb-widget-root';
    document.body.appendChild(this.container);

    // Create shadow DOM for style isolation
    this.shadowRoot = this.container.attachShadow({ mode: 'open' });

    // Inject styles
    const styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    this.shadowRoot.appendChild(styleSheet);

    // Create mount point
    const mountPoint = document.createElement('div');
    this.shadowRoot.appendChild(mountPoint);

    // Render widget
    render(
      <Widget
        options={this.options}
        initialOpen={this.openState}
        onOpenChange={(open) => {
          this.openState = open;
          this.openCallback?.(open);
        }}
      />,
      mountPoint
    );

    this.isInitialized = true;
    console.log('[KCB Widget] Initialized');
  }

  private detectApiBase(): string {
    // Try to detect from script src
    const scripts = document.querySelectorAll('script[src*="widget"]');
    for (const script of scripts) {
      const src = script.getAttribute('src');
      if (src) {
        try {
          const url = new URL(src, window.location.href);
          return url.origin;
        } catch {
          // Invalid URL, continue
        }
      }
    }
    return window.location.origin;
  }

  private open() {
    if (!this.isInitialized) {
      this.openState = true;
      return;
    }
    this.openState = true;
    this.rerender();
  }

  private close() {
    if (!this.isInitialized) {
      this.openState = false;
      return;
    }
    this.openState = false;
    this.rerender();
  }

  private toggle() {
    this.openState = !this.openState;
    if (this.isInitialized) {
      this.rerender();
    }
  }

  private rerender() {
    if (!this.shadowRoot || !this.options) return;

    const mountPoint = this.shadowRoot.querySelector('div:last-child');
    if (mountPoint) {
      render(
        <Widget
          options={this.options}
          initialOpen={this.openState}
          onOpenChange={(open) => {
            this.openState = open;
            this.openCallback?.(open);
          }}
        />,
        mountPoint
      );
    }
  }

  private destroy() {
    if (this.container) {
      this.container.remove();
    }
    this.container = null;
    this.shadowRoot = null;
    this.options = null;
    this.isInitialized = false;
    this.openState = false;
    console.log('[KCB Widget] Destroyed');
  }

  onOpenChange(callback: (open: boolean) => void) {
    this.openCallback = callback;
  }
}

// ============================================================================
// Global API
// ============================================================================

const manager = new KCBWidgetManager();

// Create global kcb function
function kcb(command: string, payload?: any) {
  manager.handleCommand(command, payload);
}

// Replace queue with actual function
(window as any).kcb = kcb;

// Also expose manager for advanced usage
(window as any).KCBWidget = manager;

export { kcb, manager as KCBWidget };
