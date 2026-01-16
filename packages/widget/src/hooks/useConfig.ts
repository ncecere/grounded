import { useState, useEffect } from 'preact/hooks';
import type { WidgetConfig } from '../types';

interface UseConfigOptions {
  token: string;
  apiBase: string;
  enabled?: boolean; // Only load config when enabled (e.g., when widget is open)
}

export function useConfig({ token, apiBase, enabled = true }: UseConfigOptions) {
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Don't load config until enabled
    if (!enabled) {
      return;
    }

    async function loadConfig() {
      setIsLoading(true);
      try {
        const response = await fetch(`${apiBase}/api/v1/widget/${token}/config`);

        if (!response.ok) {
          throw new Error('Failed to load widget configuration');
        }

        const data = await response.json();
        setConfig(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Configuration error');
        // Set default config on error
        setConfig({
          agentName: 'Assistant',
          description: "Ask me anything. I'm here to assist you.",
          welcomeMessage: 'How can I help?',
          logoUrl: null,
          isPublic: true,
        });
      } finally {
        setIsLoading(false);
      }
    }

    loadConfig();
  }, [token, apiBase, enabled]);

  return { config, isLoading, error };
}
