import { useState, useEffect } from 'preact/hooks';
import type { WidgetConfig } from '../types';

interface UseConfigOptions {
  token: string;
  apiBase: string;
}

export function useConfig({ token, apiBase }: UseConfigOptions) {
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadConfig() {
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
  }, [token, apiBase]);

  return { config, isLoading, error };
}
