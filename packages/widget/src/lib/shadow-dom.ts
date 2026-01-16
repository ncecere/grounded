import styles from '../styles';

export type ColorScheme = 'light' | 'dark' | 'auto';

export interface ShadowDOMSetupOptions {
  containerId: string;
  containerStyle?: string;
  colorScheme?: ColorScheme;
}

export interface ShadowDOMContext {
  container: HTMLElement;
  shadowRoot: ShadowRoot;
  mountPoint: HTMLElement;
  cleanup: () => void;
}

/**
 * Creates a Shadow DOM container with styles injected and theme applied.
 * Used by both the widget and published chat for consistent setup.
 */
export function createShadowDOM(options: ShadowDOMSetupOptions): ShadowDOMContext {
  const {
    containerId,
    containerStyle = '',
    colorScheme = 'auto',
  } = options;

  // Create container
  const container = document.createElement('div');
  container.id = containerId;
  if (containerStyle) {
    container.style.cssText = containerStyle;
  }
  document.body.appendChild(container);

  // Create shadow DOM for style isolation
  const shadowRoot = container.attachShadow({ mode: 'open' });

  // Inject styles
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  shadowRoot.appendChild(styleSheet);

  // Apply theme class to shadow host
  applyTheme(container, colorScheme);

  // Set up media query listener for auto mode
  let mediaQuery: MediaQueryList | null = null;
  let mediaQueryListener: ((e: MediaQueryListEvent) => void) | null = null;

  if (colorScheme === 'auto') {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQueryListener = () => {
      // For auto mode, CSS media query handles it, but we can log for debugging
      console.log('[Grounded] System theme changed');
    };
    mediaQuery.addEventListener('change', mediaQueryListener);
  }

  // Create mount point inside shadow root
  const mountPoint = document.createElement('div');
  mountPoint.style.cssText = 'height:100%;width:100%;';
  shadowRoot.appendChild(mountPoint);

  // Cleanup function
  const cleanup = () => {
    if (mediaQuery && mediaQueryListener) {
      mediaQuery.removeEventListener('change', mediaQueryListener);
    }
    container.remove();
  };

  return {
    container,
    shadowRoot,
    mountPoint,
    cleanup,
  };
}

/**
 * Applies theme class to the shadow host element.
 */
export function applyTheme(host: HTMLElement, colorScheme: ColorScheme): void {
  // Remove existing theme classes
  host.classList.remove('light', 'dark');

  if (colorScheme === 'light') {
    host.classList.add('light');
  } else if (colorScheme === 'dark') {
    host.classList.add('dark');
  }
  // For 'auto', we don't add a class - CSS media query handles it
}
