import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type SystemSetting, type AdminApiToken, type AdminApiTokenWithSecret } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { FormSection } from "@/components/ui/form-section";
import { InfoBox } from "@/components/ui/info-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ApiKeyManager } from "@/components/api-key-manager";
import {
  CheckCircle,
  XCircle,
  Mail,
  AlertTriangle,
  Play,
  Square,
  RefreshCw,
  Key,
  BarChart3,
  Bell,
  Info,
  KeyRound,
} from "lucide-react";

type SettingsTab = "auth" | "quotas" | "email" | "alerts" | "tokens";

interface SettingInputProps {
  setting: SystemSetting;
  onUpdate: (key: string, value: string | number | boolean) => void;
  isUpdating: boolean;
}

function SettingInput({ setting, onUpdate, isUpdating }: SettingInputProps) {
  const [localValue, setLocalValue] = useState<string>(
    setting.isSecret ? "" : String(setting.value)
  );
  const [hasChanged, setHasChanged] = useState(false);

  const handleChange = (value: string) => {
    setLocalValue(value);
    setHasChanged(true);
  };

  const handleSave = () => {
    if (!hasChanged) return;

    let parsedValue: string | number | boolean = localValue;

    // Try to parse as number or boolean
    if (localValue === "true") parsedValue = true;
    else if (localValue === "false") parsedValue = false;
    else if (!isNaN(Number(localValue)) && localValue !== "") parsedValue = Number(localValue);

    onUpdate(setting.key, parsedValue);
    setHasChanged(false);
  };

  const inputType = setting.isSecret ? "password" : "text";
  const placeholder = setting.isSecret ? "Enter new value to update" : "";

  return (
    <div className="py-4 border-b border-border last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <Label className="text-sm font-medium text-foreground">
            {setting.key.split(".").pop()?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">{setting.description}</p>
          {setting.isSecret && setting.isConfigured && (
            <p className="mt-1 text-xs text-success">Configured (hidden)</p>
          )}
        </div>
        <div className="flex items-center gap-2 w-80">
          <Input
            type={inputType}
            value={localValue}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1"
          />
          {hasChanged && (
            <Button
              onClick={handleSave}
              disabled={isUpdating}
              size="sm"
            >
              Save
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsSection({
  title,
  description,
  settings,
  onUpdate,
  isUpdating
}: {
  title: string;
  description: string;
  settings: SystemSetting[];
  onUpdate: (key: string, value: string | number | boolean) => void;
  isUpdating: boolean;
}) {
  return (
    <FormSection title={title} description={description}>
      {settings.map((setting) => (
        <SettingInput
          key={setting.key}
          setting={setting}
          onUpdate={onUpdate}
          isUpdating={isUpdating}
        />
      ))}
    </FormSection>
  );
}

export function AdminSettings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("auth");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api.getAdminSettings(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string | number | boolean }) =>
      api.updateAdminSetting(key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
    },
  });

  const handleUpdate = (key: string, value: string | number | boolean) => {
    updateMutation.mutate({ key, value });
  };

  const tabDescriptions: Record<SettingsTab, { title: string; description: string }> = {
    auth: {
      title: "Authentication Settings",
      description: "Configure authentication providers and registration settings.",
    },
    quotas: {
      title: "Default Quotas",
      description: "Set default resource limits for new tenants. Existing tenants are not affected.",
    },
    email: {
      title: "Email (SMTP) Settings",
      description: "Configure SMTP server for sending emails. Required for alerts and notifications.",
    },
    alerts: {
      title: "Alert Settings",
      description: "Configure automated health monitoring alerts for tenants.",
    },
    tokens: {
      title: "API Tokens",
      description: "Create and manage API tokens for system administration automation.",
    },
  };

  const filteredSettings = data?.settings.filter((s) => s.category === activeTab) || [];

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingSkeleton variant="page" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title="System Settings"
        description="Configure global system settings. Environment variables take precedence over database settings."
      />

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as SettingsTab)}>
        <TabsList className="mb-6">
          <TabsTrigger value="auth" className="gap-2">
            <Key className="w-4 h-4" />
            Authentication
          </TabsTrigger>
          <TabsTrigger value="quotas" className="gap-2">
            <BarChart3 className="w-4 h-4" />
            Quotas
          </TabsTrigger>
          <TabsTrigger value="email" className="gap-2">
            <Mail className="w-4 h-4" />
            Email (SMTP)
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-2">
            <Bell className="w-4 h-4" />
            Alerts
          </TabsTrigger>
          <TabsTrigger value="tokens" className="gap-2">
            <KeyRound className="w-4 h-4" />
            API Tokens
          </TabsTrigger>
        </TabsList>

        <TabsContent value="auth">
          <SettingsSection
            title={tabDescriptions.auth.title}
            description={tabDescriptions.auth.description}
            settings={filteredSettings}
            onUpdate={handleUpdate}
            isUpdating={updateMutation.isPending}
          />
          <InfoBox icon={Info} className="mt-6">
            <h3 className="text-sm font-medium">AI Models</h3>
            <p className="mt-1 text-sm">
              LLM and Embedding models are now configured in the <strong>AI Models</strong> section.
              Configure providers and models there to enable chat and search functionality.
            </p>
          </InfoBox>
        </TabsContent>

        <TabsContent value="quotas">
          <SettingsSection
            title={tabDescriptions.quotas.title}
            description={tabDescriptions.quotas.description}
            settings={filteredSettings}
            onUpdate={handleUpdate}
            isUpdating={updateMutation.isPending}
          />
        </TabsContent>

        <TabsContent value="email">
          <SettingsSection
            title={tabDescriptions.email.title}
            description={tabDescriptions.email.description}
            settings={filteredSettings}
            onUpdate={handleUpdate}
            isUpdating={updateMutation.isPending}
          />
          <EmailTestSection />
        </TabsContent>

        <TabsContent value="alerts">
          <SettingsSection
            title={tabDescriptions.alerts.title}
            description={tabDescriptions.alerts.description}
            settings={filteredSettings}
            onUpdate={handleUpdate}
            isUpdating={updateMutation.isPending}
          />
          <AlertControlSection />
          <InfoBox icon={AlertTriangle} variant="warning" className="mt-6">
            <h3 className="text-sm font-medium">Alert Requirements</h3>
            <p className="mt-1 text-sm">
              Email alerts require a configured SMTP server. Make sure to set up your
              SMTP settings in the <strong>Email (SMTP)</strong> tab before enabling alerts.
            </p>
          </InfoBox>
        </TabsContent>

        <TabsContent value="tokens">
          <AdminTokensSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================================
// Email Test Section
// ============================================================================

function EmailTestSection() {
  const [testEmail, setTestEmail] = useState("");
  const [verifyResult, setVerifyResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const verifyMutation = useMutation({
    mutationFn: () => api.verifySmtp(),
    onSuccess: (data) => setVerifyResult(data),
    onError: (error) => setVerifyResult({ success: false, message: error.message }),
  });

  const testMutation = useMutation({
    mutationFn: (email: string) => api.sendTestEmail(email),
    onSuccess: (data) => setTestResult(data),
    onError: (error) => setTestResult({ success: false, message: error.message }),
  });

  return (
    <FormSection
      title="Test Email Configuration"
      description="Verify your SMTP settings and send a test email."
      className="mt-6"
    >
      {/* Verify Connection */}
      <div className="py-4 border-b border-border">
        <h3 className="text-sm font-medium text-foreground mb-2">1. Verify SMTP Connection</h3>
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={() => verifyMutation.mutate()}
            disabled={verifyMutation.isPending}
          >
            {verifyMutation.isPending ? "Verifying..." : "Verify Connection"}
          </Button>
          {verifyResult && (
            <div className={`flex items-center gap-2 text-sm ${verifyResult.success ? "text-success" : "text-destructive"}`}>
              {verifyResult.success ? (
                <CheckCircle className="w-4 h-4" />
              ) : (
                <XCircle className="w-4 h-4" />
              )}
              {verifyResult.message}
            </div>
          )}
        </div>
      </div>

      {/* Send Test Email */}
      <div className="py-4">
        <h3 className="text-sm font-medium text-foreground mb-2">2. Send Test Email</h3>
        <div className="flex items-center gap-4">
          <Input
            type="email"
            placeholder="Enter email address"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            className="w-64"
          />
          <Button
            onClick={() => testMutation.mutate(testEmail)}
            disabled={testMutation.isPending || !testEmail}
          >
            <Mail className="w-4 h-4 mr-2" />
            {testMutation.isPending ? "Sending..." : "Send Test Email"}
          </Button>
        </div>
        {testResult && (
          <div className={`mt-2 flex items-center gap-2 text-sm ${testResult.success ? "text-success" : "text-destructive"}`}>
            {testResult.success ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <XCircle className="w-4 h-4" />
            )}
            {testResult.message}
          </div>
        )}
      </div>
    </FormSection>
  );
}

// ============================================================================
// Alert Control Section
// ============================================================================

// ============================================================================
// Admin Tokens Section
// ============================================================================

function AdminTokensSection() {
  const [newToken, setNewToken] = useState<AdminApiTokenWithSecret | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-tokens"],
    queryFn: api.listAdminTokens,
  });

  const createMutation = useMutation({
    mutationFn: api.createAdminToken,
    onSuccess: (data) => {
      setNewToken(data);
      queryClient.invalidateQueries({ queryKey: ["admin-tokens"] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: api.revokeAdminToken,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-tokens"] });
    },
  });

  return (
    <ApiKeyManager<AdminApiToken, AdminApiTokenWithSecret>
      keys={data?.tokens || []}
      isLoading={isLoading}
      onRevoke={(id) => revokeMutation.mutate(id)}
      isRevoking={revokeMutation.isPending}
      onCreate={(data) => createMutation.mutate({
        name: data.name,
        expiresAt: data.expiresAt,
      })}
      isCreating={createMutation.isPending}
      createError={createMutation.error}
      newKey={newToken}
      onNewKeyDismiss={() => setNewToken(null)}
      title="Admin Tokens"
      description="Manage admin tokens for system automation and CI/CD pipelines."
      infoTitle="Using Admin Tokens"
      infoDescription="Admin tokens allow you to authenticate API requests for automation and CI/CD pipelines. Use them with the Authorization header:"
      authHeaderExample="Authorization: Bearer grounded_admin_..."
      showScopes={false}
    />
  );
}

// ============================================================================
// Alert Control Section
// ============================================================================

function AlertControlSection() {
  const queryClient = useQueryClient();
  const [checkResult, setCheckResult] = useState<{
    checked: boolean;
    tenantsWithIssues: number;
    alertSent: boolean;
    error?: string;
  } | null>(null);

  const { data: alertStatus, isLoading: statusLoading } = useQuery({
    queryKey: ["alert-status"],
    queryFn: () => api.getAlertStatus(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const runCheckMutation = useMutation({
    mutationFn: () => api.runHealthCheck(),
    onSuccess: (data) => {
      setCheckResult(data);
      queryClient.invalidateQueries({ queryKey: ["alert-status"] });
    },
    onError: (error) => setCheckResult({
      checked: false,
      tenantsWithIssues: 0,
      alertSent: false,
      error: error.message,
    }),
  });

  const startMutation = useMutation({
    mutationFn: () => api.startAlertScheduler(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alert-status"] }),
  });

  const stopMutation = useMutation({
    mutationFn: () => api.stopAlertScheduler(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alert-status"] }),
  });

  const isRunning = alertStatus?.schedulerRunning ?? false;

  return (
    <FormSection
      title="Alert Scheduler"
      description="Control the automated health check scheduler and run manual checks."
      className="mt-6"
    >
      {/* Scheduler Status */}
      <div className="py-4 border-b border-border">
        <h3 className="text-sm font-medium text-foreground mb-2">Scheduler Status</h3>
        <div className="flex items-center gap-4">
          <StatusBadge
            status={isRunning ? "active" : "inactive"}
            label={statusLoading ? "Loading..." : isRunning ? "Running" : "Stopped"}
          />
          {alertStatus?.lastCheckTime && (
            <span className="text-sm text-muted-foreground">
              Last check: {new Date(alertStatus.lastCheckTime).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Scheduler Controls */}
      <div className="py-4 border-b border-border">
        <h3 className="text-sm font-medium text-foreground mb-2">Scheduler Controls</h3>
        <div className="flex items-center gap-3">
          {isRunning ? (
            <Button
              variant="outline"
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
            >
              <Square className="w-4 h-4 mr-2" />
              {stopMutation.isPending ? "Stopping..." : "Stop Scheduler"}
            </Button>
          ) : (
            <Button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
            >
              <Play className="w-4 h-4 mr-2" />
              {startMutation.isPending ? "Starting..." : "Start Scheduler"}
            </Button>
          )}
        </div>
      </div>

      {/* Manual Check */}
      <div className="py-4">
        <h3 className="text-sm font-medium text-foreground mb-2">Manual Health Check</h3>
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={() => runCheckMutation.mutate()}
            disabled={runCheckMutation.isPending}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${runCheckMutation.isPending ? "animate-spin" : ""}`} />
            {runCheckMutation.isPending ? "Running..." : "Run Health Check Now"}
          </Button>
        </div>
        {checkResult && (
          <div className={`mt-3 p-3 rounded-lg ${
            checkResult.error
              ? "bg-destructive/10 text-destructive"
              : checkResult.tenantsWithIssues > 0
              ? "bg-warning/10 text-warning"
              : "bg-success/10 text-success"
          }`}>
            {checkResult.error ? (
              <p>Error: {checkResult.error}</p>
            ) : checkResult.checked ? (
              <p>
                Check complete. {checkResult.tenantsWithIssues === 0
                  ? "All tenants are healthy."
                  : `Found ${checkResult.tenantsWithIssues} tenant(s) with issues.`}
                {checkResult.alertSent && " Alert email sent."}
              </p>
            ) : (
              <p>Check skipped (alerts disabled or not configured)</p>
            )}
          </div>
        )}
      </div>
    </FormSection>
  );
}
