import { render } from 'preact';
import { Widget } from './components/Widget';
import { createShadowDOM, applyTheme, type ColorScheme, type ShadowDOMContext } from './lib/shadow-dom';
import type { WidgetOptions } from './types';

// ============================================================================
// Widget Manager - Handles initialization and API
// ============================================================================

class GroundedWidgetManager {
  private context: ShadowDOMContext | null = null;
  private options: WidgetOptions | null = null;
  private isInitialized = false;
  private openState = false;
  private openCallback: ((open: boolean) => void) | null = null;

  constructor() {
    // Process any queued commands
    this.processQueue();
  }

  private processQueue() {
    const queue = (window as any).grounded?.q || [];
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
        console.warn(`[Grounded Widget] Unknown command: ${command}`);
    }
  }

  private init(options: WidgetOptions) {
    if (this.isInitialized) {
      console.warn('[Grounded Widget] Already initialized');
      return;
    }

    if (!options?.token) {
      console.error('[Grounded Widget] Token is required');
      return;
    }

    this.options = {
      ...options,
      apiBase: options.apiBase || this.detectApiBase(),
      colorScheme: options.colorScheme || 'auto',
    };

    // Create Shadow DOM container using shared utility
    this.context = createShadowDOM({
      containerId: 'grounded-widget-root',
      colorScheme: this.options.colorScheme as ColorScheme,
    });

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
      this.context.mountPoint
    );

    this.isInitialized = true;
    console.log('[Grounded Widget] Initialized with colorScheme:', this.options.colorScheme);
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
    if (!this.context || !this.options) return;

    render(
      <Widget
        options={this.options}
        initialOpen={this.openState}
        onOpenChange={(open) => {
          this.openState = open;
          this.openCallback?.(open);
        }}
      />,
      this.context.mountPoint
    );
  }

  private destroy() {
    if (this.context) {
      this.context.cleanup();
      this.context = null;
    }
    this.options = null;
    this.isInitialized = false;
    this.openState = false;
    console.log('[Grounded Widget] Destroyed');
  }

  onOpenChange(callback: (open: boolean) => void) {
    this.openCallback = callback;
  }
}

// ============================================================================
// Global API
// ============================================================================

const manager = new GroundedWidgetManager();

// Create global grounded function
function grounded(command: string, payload?: any) {
  manager.handleCommand(command, payload);
}

// Replace queue with actual function
(window as any).grounded = grounded;

// Also expose manager for advanced usage
(window as any).GroundedWidget = manager;

export { grounded, manager as GroundedWidget };
