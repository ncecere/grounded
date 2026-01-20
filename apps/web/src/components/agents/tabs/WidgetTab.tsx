import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Agent } from "../../../lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import type { ButtonConfig } from "../types";
import { defaultButtonConfig, colorPresets } from "../types";

interface WidgetTabProps {
  agent: Agent;
}

export function WidgetTab({ agent }: WidgetTabProps) {
  const queryClient = useQueryClient();
  const [buttonConfig, setButtonConfig] = useState<ButtonConfig>(defaultButtonConfig);
  const [copied, setCopied] = useState(false);

  const { data: widgetConfigData } = useQuery({
    queryKey: ["widget-config", agent.id],
    queryFn: () => api.getWidgetConfig(agent.id),
    enabled: !!agent,
  });

  useEffect(() => {
    if (widgetConfigData?.widgetConfig) {
      const theme = widgetConfigData.widgetConfig.theme as ButtonConfig | undefined;
      setButtonConfig({
        buttonStyle: theme?.buttonStyle || "circle",
        buttonSize: theme?.buttonSize || "medium",
        buttonText: theme?.buttonText || "Chat with us",
        buttonIcon: theme?.buttonIcon || "chat",
        buttonColor: theme?.buttonColor || "#2563eb",
        buttonPosition: theme?.buttonPosition || "bottom-right",
        customIconUrl: theme?.customIconUrl || "",
        customIconSize: theme?.customIconSize || null,
      });
    }
  }, [widgetConfigData]);

  const updateWidgetConfigMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Omit<ButtonConfig, 'customIconUrl' | 'customIconSize'> & { customIconUrl: string | null; customIconSize: number | null } }) =>
      api.updateWidgetConfig(id, { theme: data }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["widget-config", variables.id] });
    },
  });

  const handleSave = () => {
    updateWidgetConfigMutation.mutate({
      id: agent.id,
      data: {
        ...buttonConfig,
        customIconUrl: buttonConfig.customIconUrl || null,
        customIconSize: buttonConfig.customIconSize || null,
      },
    });
  };

  const handleTestWidget = async () => {
    await api.updateWidgetConfig(agent.id, {
      theme: {
        ...buttonConfig,
        customIconUrl: buttonConfig.customIconUrl || null,
        customIconSize: buttonConfig.customIconSize || null,
      },
    });

    const testHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Widget Test - ${agent.name}</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
    h1 { color: #1f2937; }
    p { color: #6b7280; line-height: 1.6; }
    .info { background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 20px 0; }
    code { background: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-size: 14px; }
  </style>
</head>
<body>
  <h1>Widget Test Page</h1>
  <p>This is a test page for the <strong>${agent.name}</strong> widget.</p>
  <div class="info">
    <p>The chat widget should appear in the bottom-right corner. Click the button to open it and test the conversation.</p>
    <p>Token: <code>${widgetConfigData?.tokens?.[0]?.token || 'loading...'}</code></p>
  </div>
  <p>Try asking questions to test your agent's responses and knowledge base integration.</p>

  <script>
    (function(w,d,s,o,f,js,fjs){
      w['GroundedWidget']=o;w[o]=w[o]||function(){
      (w[o].q=w[o].q||[]).push(arguments)};
      js=d.createElement(s);fjs=d.getElementsByTagName(s)[0];
      js.id=o;js.src=f;js.async=1;fjs.parentNode.insertBefore(js,fjs);
    })(window,document,'script','grounded','${window.location.origin}/widget.js');
    grounded('init', { token: '${widgetConfigData?.tokens?.[0]?.token || ''}', apiBase: '${window.__GROUNDED_CONFIG__?.API_URL || window.location.origin}' });
  </script>
</body>
</html>`;
    const blob = new Blob([testHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  const copyEmbedCode = () => {
    const code = `<script>
  (function(w,d,s,o,f,js,fjs){
    w['GroundedWidget']=o;w[o]=w[o]||function(){
    (w[o].q=w[o].q||[]).push(arguments)};
    js=d.createElement(s);fjs=d.getElementsByTagName(s)[0];
    js.id=o;js.src=f;js.async=1;fjs.parentNode.insertBefore(js,fjs);
  })(window,document,'script','grounded','/widget.js');
  grounded('init', { token: '${widgetConfigData?.tokens?.[0]?.token || ""}' });
</script>`;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Button Style Options */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-foreground">Button Appearance</h3>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Style</Label>
            <Select
              value={buttonConfig.buttonStyle}
              onValueChange={(value: "circle" | "pill" | "square") =>
                setButtonConfig({ ...buttonConfig, buttonStyle: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="circle">Circle</SelectItem>
                <SelectItem value="pill">Pill (with text)</SelectItem>
                <SelectItem value="square">Square</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Size</Label>
            <Select
              value={buttonConfig.buttonSize}
              onValueChange={(value: "small" | "medium" | "large") =>
                setButtonConfig({ ...buttonConfig, buttonSize: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="small">Small</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="large">Large</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Position</Label>
            <Select
              value={buttonConfig.buttonPosition}
              onValueChange={(value: "bottom-right" | "bottom-left") =>
                setButtonConfig({ ...buttonConfig, buttonPosition: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bottom-right">Bottom Right</SelectItem>
                <SelectItem value="bottom-left">Bottom Left</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Icon</Label>
            <Select
              value={buttonConfig.customIconUrl ? "custom" : buttonConfig.buttonIcon}
              onValueChange={(value: string) => {
                if (value !== "custom") {
                  setButtonConfig({
                    ...buttonConfig,
                    buttonIcon: value as "chat" | "help" | "question" | "message",
                    customIconUrl: "",
                  });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chat">Chat bubble</SelectItem>
                <SelectItem value="message">Message</SelectItem>
                <SelectItem value="help">Help circle</SelectItem>
                <SelectItem value="question">Question mark</SelectItem>
                <SelectItem value="custom">Custom Image</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {buttonConfig.buttonStyle === "pill" && (
          <div className="space-y-2">
            <Label>Button Text</Label>
            <Input
              value={buttonConfig.buttonText}
              onChange={(e) => setButtonConfig({ ...buttonConfig, buttonText: e.target.value })}
              placeholder="Chat with us"
            />
          </div>
        )}

        <div className="space-y-2">
          <Label>Custom Icon URL (optional)</Label>
          <Input
            type="url"
            value={buttonConfig.customIconUrl}
            onChange={(e) => setButtonConfig({ ...buttonConfig, customIconUrl: e.target.value })}
            placeholder="https://example.com/icon.png"
          />
          <p className="text-xs text-muted-foreground">
            Paste a URL to your own icon image. Leave empty to use the selected icon above.
          </p>
        </div>

        {buttonConfig.customIconUrl && (
          <div className="space-y-2">
            <Label>Custom Icon Size (optional)</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={buttonConfig.customIconSize || ""}
                onChange={(e) =>
                  setButtonConfig({
                    ...buttonConfig,
                    customIconSize: e.target.value ? parseInt(e.target.value) : null,
                  })
                }
                placeholder="24"
                min={12}
                max={64}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">px</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave empty to use default size based on button size (20-28px).
            </p>
          </div>
        )}

        {/* Color Selection */}
        <div className="space-y-2">
          <Label>Button Color</Label>
          <div className="flex flex-wrap gap-2 mb-2">
            {colorPresets.map((color) => (
              <button
                key={color.value}
                type="button"
                onClick={() => setButtonConfig({ ...buttonConfig, buttonColor: color.value })}
                className={`w-8 h-8 rounded-full border-2 transition-all ${
                  buttonConfig.buttonColor === color.value
                    ? "border-foreground scale-110"
                    : "border-transparent hover:scale-105"
                }`}
                style={{ backgroundColor: color.value }}
                title={color.name}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Custom:</span>
            <input
              type="color"
              value={buttonConfig.buttonColor}
              onChange={(e) => setButtonConfig({ ...buttonConfig, buttonColor: e.target.value })}
              className="w-8 h-8 rounded cursor-pointer border border-input"
            />
            <Input
              value={buttonConfig.buttonColor}
              onChange={(e) => setButtonConfig({ ...buttonConfig, buttonColor: e.target.value })}
              className="w-24 font-mono text-xs"
              placeholder="#2563eb"
            />
          </div>
        </div>

        {/* Preview */}
        <div className="p-4 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground mb-3">Preview</p>
          <div className="flex items-center justify-center">
            <div
              className={`
                flex items-center justify-center gap-2 text-white font-medium shadow-lg
                ${buttonConfig.buttonStyle === "circle" ? "rounded-full" : ""}
                ${buttonConfig.buttonStyle === "pill" ? "rounded-full px-4" : ""}
                ${buttonConfig.buttonStyle === "square" ? "rounded-xl" : ""}
                ${buttonConfig.buttonSize === "small" ? "h-11 text-sm" : ""}
                ${buttonConfig.buttonSize === "medium" ? "h-14 text-base" : ""}
                ${buttonConfig.buttonSize === "large" ? "h-16 text-lg" : ""}
                ${buttonConfig.buttonStyle !== "pill" && buttonConfig.buttonSize === "small" ? "w-11" : ""}
                ${buttonConfig.buttonStyle !== "pill" && buttonConfig.buttonSize === "medium" ? "w-14" : ""}
                ${buttonConfig.buttonStyle !== "pill" && buttonConfig.buttonSize === "large" ? "w-16" : ""}
              `}
              style={{ backgroundColor: buttonConfig.buttonColor }}
            >
              {buttonConfig.customIconUrl ? (
                <img
                  src={buttonConfig.customIconUrl}
                  alt=""
                  className="object-contain"
                  style={buttonConfig.customIconSize ? { width: buttonConfig.customIconSize, height: buttonConfig.customIconSize } : undefined}
                  width={buttonConfig.customIconSize || (buttonConfig.buttonSize === "small" ? 20 : buttonConfig.buttonSize === "large" ? 28 : 24)}
                  height={buttonConfig.customIconSize || (buttonConfig.buttonSize === "small" ? 20 : buttonConfig.buttonSize === "large" ? 28 : 24)}
                />
              ) : (
                <svg
                  className={`
                    ${buttonConfig.buttonSize === "small" ? "w-5 h-5" : ""}
                    ${buttonConfig.buttonSize === "medium" ? "w-6 h-6" : ""}
                    ${buttonConfig.buttonSize === "large" ? "w-7 h-7" : ""}
                  `}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {buttonConfig.buttonIcon === "chat" && <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />}
                  {buttonConfig.buttonIcon === "message" && <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />}
                  {buttonConfig.buttonIcon === "help" && <><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>}
                  {buttonConfig.buttonIcon === "question" && <><path d="M8.5 8.5a3.5 3.5 0 1 1 5 3.15c-.65.4-1.5 1.15-1.5 2.35v1" /><circle cx="12" cy="19" r="0.5" fill="currentColor" /></>}
                </svg>
              )}
              {buttonConfig.buttonStyle === "pill" && <span>{buttonConfig.buttonText}</span>}
            </div>
          </div>
        </div>

        <Button
          onClick={handleSave}
          disabled={updateWidgetConfigMutation.isPending}
          className="w-full"
        >
          {updateWidgetConfigMutation.isPending ? "Saving..." : "Save Button Style"}
        </Button>
      </div>

      {/* Embed Code */}
      <div className="pt-6 border-t border-border space-y-2">
        <h3 className="text-sm font-medium text-foreground">Embed Script</h3>
        <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-xs overflow-x-auto">
{`<script>
  (function(w,d,s,o,f,js,fjs){
    w['GroundedWidget']=o;w[o]=w[o]||function(){
    (w[o].q=w[o].q||[]).push(arguments)};
    js=d.createElement(s);fjs=d.getElementsByTagName(s)[0];
    js.id=o;js.src=f;js.async=1;fjs.parentNode.insertBefore(js,fjs);
  })(window,document,'script','grounded','/widget.js');
  grounded('init', { token: '${widgetConfigData?.tokens?.[0]?.token || "loading..."}' });
</script>`}
        </pre>
        <div className="flex gap-4 items-center">
          <button onClick={copyEmbedCode} className="text-sm text-primary hover:text-primary/80">
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
          {copied && (
            <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </span>
          )}
        </div>
      </div>

      {/* Test Widget Button */}
      <div className="pt-4">
        <Button onClick={handleTestWidget} variant="outline" className="w-full">
          Test Widget in New Tab
        </Button>
      </div>
    </div>
  );
}
