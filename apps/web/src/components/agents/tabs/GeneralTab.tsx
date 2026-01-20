import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Agent } from "../../../lib/api";
import { Switch } from "../../ui/switch";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Textarea } from "../../ui/textarea";
import type { AgentFormData } from "../types";
import { VALIDATION_LIMITS, type FormValidationErrors } from "../AgentFormModal";

interface GeneralTabProps {
  agent: Agent | null;
  formData: AgentFormData;
  onFormChange: (updates: Partial<AgentFormData>) => void;
  validationErrors: FormValidationErrors;
  touched: Record<string, boolean>;
  markTouched: (field: string) => void;
  isEditMode: boolean;
}

export function GeneralTab({
  agent,
  formData,
  onFormChange,
  validationErrors,
  touched,
  markTouched,
  isEditMode,
}: GeneralTabProps) {
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updateAgent>[1] }) =>
      api.updateAgent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });

  const getFieldError = (field: keyof FormValidationErrors) => {
    return touched[field] ? validationErrors[field] : undefined;
  };

  return (
    <div className="space-y-6">
      {/* Status Toggle - Edit mode only */}
      {isEditMode && agent && (
        <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-muted/30">
          <div>
            <Label className="text-base font-medium">Agent Status</Label>
            <p className="text-sm text-muted-foreground mt-0.5">
              Disabled agents cannot be used for chat
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-medium ${agent.isEnabled !== false ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
              {agent.isEnabled !== false ? "Enabled" : "Disabled"}
            </span>
            <Switch
              checked={agent.isEnabled !== false}
              onCheckedChange={(checked) => {
                updateMutation.mutate({
                  id: agent.id,
                  data: { isEnabled: checked },
                });
              }}
            />
          </div>
        </div>
      )}

      {/* Name */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Name *</Label>
          <span className="text-xs text-muted-foreground">
            {formData.name.length}/{VALIDATION_LIMITS.name.max}
          </span>
        </div>
        <Input
          value={formData.name}
          onChange={(e) => onFormChange({ name: e.target.value })}
          onBlur={() => markTouched("name")}
          placeholder="Support Agent"
          maxLength={VALIDATION_LIMITS.name.max}
          className={getFieldError("name") ? "border-destructive" : ""}
        />
        {getFieldError("name") && (
          <p className="text-xs text-destructive">{getFieldError("name")}</p>
        )}
      </div>

      {/* Description */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Description</Label>
          <span className="text-xs text-muted-foreground">
            {formData.description.length}/{VALIDATION_LIMITS.description.max}
          </span>
        </div>
        <Input
          value={formData.description}
          onChange={(e) => onFormChange({ description: e.target.value })}
          onBlur={() => markTouched("description")}
          placeholder="Helps users with product questions"
          maxLength={VALIDATION_LIMITS.description.max}
          className={getFieldError("description") ? "border-destructive" : ""}
        />
        {getFieldError("description") && (
          <p className="text-xs text-destructive">{getFieldError("description")}</p>
        )}
      </div>

      {/* System Prompt */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>System Prompt *</Label>
          <span className="text-xs text-muted-foreground">
            {formData.systemPrompt.length}/{VALIDATION_LIMITS.systemPrompt.max}
          </span>
        </div>
        <Textarea
          value={formData.systemPrompt}
          onChange={(e) => onFormChange({ systemPrompt: e.target.value })}
          onBlur={() => markTouched("systemPrompt")}
          rows={5}
          maxLength={VALIDATION_LIMITS.systemPrompt.max}
          className={getFieldError("systemPrompt") ? "border-destructive" : ""}
        />
        <p className="text-xs text-muted-foreground">
          Instructions that define how the agent behaves
        </p>
        {getFieldError("systemPrompt") && (
          <p className="text-xs text-destructive">{getFieldError("systemPrompt")}</p>
        )}
      </div>

      {/* Welcome Message */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Welcome Message</Label>
          <span className="text-xs text-muted-foreground">
            {formData.welcomeMessage.length}/{VALIDATION_LIMITS.welcomeMessage.max}
          </span>
        </div>
        <Input
          value={formData.welcomeMessage}
          onChange={(e) => onFormChange({ welcomeMessage: e.target.value })}
          onBlur={() => markTouched("welcomeMessage")}
          placeholder="How can I help?"
          maxLength={VALIDATION_LIMITS.welcomeMessage.max}
          className={getFieldError("welcomeMessage") ? "border-destructive" : ""}
        />
        <p className="text-xs text-muted-foreground">
          Shown in the widget empty state
        </p>
        {getFieldError("welcomeMessage") && (
          <p className="text-xs text-destructive">{getFieldError("welcomeMessage")}</p>
        )}
      </div>

      {/* Logo URL - Edit mode only */}
      {isEditMode && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Logo URL</Label>
            <span className="text-xs text-muted-foreground">
              {formData.logoUrl.length}/{VALIDATION_LIMITS.logoUrl.max}
            </span>
          </div>
          <Input
            type="url"
            value={formData.logoUrl}
            onChange={(e) => onFormChange({ logoUrl: e.target.value })}
            onBlur={() => markTouched("logoUrl")}
            placeholder="https://example.com/logo.png"
            maxLength={VALIDATION_LIMITS.logoUrl.max}
            className={getFieldError("logoUrl") ? "border-destructive" : ""}
          />
          <p className="text-xs text-muted-foreground">
            Displayed in widget header (32x32px recommended)
          </p>
          {getFieldError("logoUrl") && (
            <p className="text-xs text-destructive">{getFieldError("logoUrl")}</p>
          )}
        </div>
      )}

      {/* Agent Info - Edit mode only */}
      {isEditMode && agent && (
        <div className="p-4 bg-muted/50 rounded-lg">
          <h4 className="text-sm font-medium mb-2">Agent Info</h4>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Created</dt>
              <dd>{new Date(agent.createdAt).toLocaleDateString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Knowledge Bases</dt>
              <dd>{agent.kbIds.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Agent ID</dt>
              <dd className="font-mono text-xs">{agent.id}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
