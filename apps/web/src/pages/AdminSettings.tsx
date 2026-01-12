import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type SystemSetting } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { CheckCircle, XCircle, Mail, AlertTriangle, Play, Square, RefreshCw } from "lucide-react";

type SettingsTab = "auth" | "quotas" | "email" | "alerts";

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
    <div className="py-4 border-b border-gray-100 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <label className="block text-sm font-medium text-gray-900">
            {setting.key.split(".").pop()?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
          </label>
          <p className="mt-1 text-xs text-gray-500">{setting.description}</p>
          {setting.isSecret && setting.isConfigured && (
            <p className="mt-1 text-xs text-green-600">Configured (hidden)</p>
          )}
        </div>
        <div className="flex items-center gap-2 w-80">
          <input
            type={inputType}
            value={localValue}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
          />
          {hasChanged && (
            <button
              onClick={handleSave}
              disabled={isUpdating}
              className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              Save
            </button>
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
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      </div>
      <div className="px-6">
        {settings.map((setting) => (
          <SettingInput
            key={setting.key}
            setting={setting}
            onUpdate={onUpdate}
            isUpdating={isUpdating}
          />
        ))}
      </div>
    </div>
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

  const tabs: Array<{ id: SettingsTab; label: string; icon: string }> = [
    {
      id: "auth",
      label: "Authentication",
      icon: "M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z",
    },
    {
      id: "quotas",
      label: "Quotas",
      icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
    },
    {
      id: "email",
      label: "Email (SMTP)",
      icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
    },
    {
      id: "alerts",
      label: "Alerts",
      icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
    },
  ];

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
  };

  const filteredSettings = data?.settings.filter((s) => s.category === activeTab) || [];

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48"></div>
          <div className="h-12 bg-gray-200 rounded"></div>
          <div className="h-64 bg-gray-200 rounded-lg"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">System Settings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure global system settings. Environment variables take precedence over database settings.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group inline-flex items-center py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              <svg
                className={`w-5 h-5 mr-2 ${
                  activeTab === tab.id ? "text-blue-500" : "text-gray-400 group-hover:text-gray-500"
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
              </svg>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Settings Content */}
      <SettingsSection
        title={tabDescriptions[activeTab].title}
        description={tabDescriptions[activeTab].description}
        settings={filteredSettings}
        onUpdate={handleUpdate}
        isUpdating={updateMutation.isPending}
      />

      {/* Email Test Section - only shown on email tab */}
      {activeTab === "email" && (
        <EmailTestSection />
      )}

      {/* Alert Control Section - only shown on alerts tab */}
      {activeTab === "alerts" && (
        <>
          <AlertControlSection />
          <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex">
              <AlertTriangle className="w-5 h-5 text-yellow-500 mr-3 mt-0.5" />
              <div>
                <h3 className="text-sm font-medium text-yellow-800">Alert Requirements</h3>
                <p className="mt-1 text-sm text-yellow-700">
                  Email alerts require a configured SMTP server. Make sure to set up your
                  SMTP settings in the <strong>Email (SMTP)</strong> tab before enabling alerts.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Info Box - only shown on auth tab */}
      {activeTab === "auth" && (
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex">
            <svg className="w-5 h-5 text-blue-400 mr-3 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h3 className="text-sm font-medium text-blue-800">AI Models</h3>
              <p className="mt-1 text-sm text-blue-700">
                LLM and Embedding models are now configured in the <strong>AI Models</strong> section.
                Configure providers and models there to enable chat and search functionality.
              </p>
            </div>
          </div>
        </div>
      )}
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
    <div className="mt-6 bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <h2 className="text-lg font-semibold text-gray-900">Test Email Configuration</h2>
        <p className="mt-1 text-sm text-gray-500">
          Verify your SMTP settings and send a test email.
        </p>
      </div>
      <div className="p-6 space-y-6">
        {/* Verify Connection */}
        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-2">1. Verify SMTP Connection</h3>
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              onClick={() => verifyMutation.mutate()}
              disabled={verifyMutation.isPending}
            >
              {verifyMutation.isPending ? "Verifying..." : "Verify Connection"}
            </Button>
            {verifyResult && (
              <div className={`flex items-center gap-2 text-sm ${verifyResult.success ? "text-green-600" : "text-red-600"}`}>
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
        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-2">2. Send Test Email</h3>
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
            <div className={`mt-2 flex items-center gap-2 text-sm ${testResult.success ? "text-green-600" : "text-red-600"}`}>
              {testResult.success ? (
                <CheckCircle className="w-4 h-4" />
              ) : (
                <XCircle className="w-4 h-4" />
              )}
              {testResult.message}
            </div>
          )}
        </div>
      </div>
    </div>
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
    <div className="mt-6 bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <h2 className="text-lg font-semibold text-gray-900">Alert Scheduler</h2>
        <p className="mt-1 text-sm text-gray-500">
          Control the automated health check scheduler and run manual checks.
        </p>
      </div>
      <div className="p-6 space-y-6">
        {/* Scheduler Status */}
        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-2">Scheduler Status</h3>
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
              isRunning
                ? "bg-green-100 text-green-800"
                : "bg-gray-100 text-gray-800"
            }`}>
              <span className={`w-2 h-2 rounded-full ${isRunning ? "bg-green-500" : "bg-gray-400"}`} />
              {statusLoading ? "Loading..." : isRunning ? "Running" : "Stopped"}
            </div>
            {alertStatus?.lastCheckTime && (
              <span className="text-sm text-gray-500">
                Last check: {new Date(alertStatus.lastCheckTime).toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {/* Scheduler Controls */}
        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-2">Scheduler Controls</h3>
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
        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-2">Manual Health Check</h3>
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
                ? "bg-red-50 text-red-700"
                : checkResult.tenantsWithIssues > 0
                ? "bg-yellow-50 text-yellow-700"
                : "bg-green-50 text-green-700"
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
      </div>
    </div>
  );
}
