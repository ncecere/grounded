import { render } from 'preact';
import { Widget } from './components/Widget';
import styles from './styles';
import type { WidgetOptions, WidgetColorScheme } from './types';

// ============================================================================
// Widget Manager - Handles initialization and API
// ============================================================================

class GroundedWidgetManager {
  private container: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private options: WidgetOptions | null = null;
  private isInitialized = false;
  private openState = false;
  private openCallback: ((open: boolean) => void) | null = null;
  private mediaQueryListener: ((e: MediaQueryListEvent) => void) | null = null;
  private mediaQuery: MediaQueryList | null = null;

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

    // Create container
    this.container = document.createElement('div');
    this.container.id = 'grounded-widget-root';
    document.body.appendChild(this.container);

    // Create shadow DOM for style isolation
    this.shadowRoot = this.container.attachShadow({ mode: 'open' });

    // Inject styles
    const styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    this.shadowRoot.appendChild(styleSheet);

    // Apply theme class to shadow host
    this.applyTheme(this.options.colorScheme!);

    // Set up system preference listener for 'auto' mode
    if (this.options.colorScheme === 'auto') {
      this.setupMediaQueryListener();
    }

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
    console.log('[Grounded Widget] Initialized with colorScheme:', this.options.colorScheme);
  }

  private applyTheme(colorScheme: WidgetColorScheme) {
    if (!this.shadowRoot) return;

    const host = this.shadowRoot.host as HTMLElement;

    // Remove existing theme classes
    host.classList.remove('light', 'dark');

    if (colorScheme === 'light') {
      host.classList.add('light');
    } else if (colorScheme === 'dark') {
      host.classList.add('dark');
    }
    // For 'auto', we don't add a class - CSS media query handles it
  }

  private setupMediaQueryListener() {
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    this.mediaQueryListener = () => {
      // For auto mode, we don't need to do anything special
      // The CSS media query handles the color changes
      // But we can log the change for debugging
      console.log('[Grounded Widget] System theme changed');
    };

    this.mediaQuery.addEventListener('change', this.mediaQueryListener);
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
    // Clean up media query listener
    if (this.mediaQuery && this.mediaQueryListener) {
      this.mediaQuery.removeEventListener('change', this.mediaQueryListener);
    }
    this.mediaQuery = null;
    this.mediaQueryListener = null;

    if (this.container) {
      this.container.remove();
    }
    this.container = null;
    this.shadowRoot = null;
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
