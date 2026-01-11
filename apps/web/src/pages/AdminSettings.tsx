import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type SystemSetting } from "../lib/api";

type SettingsTab = "llm" | "embedding" | "auth" | "quotas";

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
  const [activeTab, setActiveTab] = useState<SettingsTab>("llm");
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
      id: "llm",
      label: "LLM",
      icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
    },
    {
      id: "embedding",
      label: "Embedding",
      icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4",
    },
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
  ];

  const tabDescriptions: Record<SettingsTab, { title: string; description: string }> = {
    llm: {
      title: "LLM Configuration",
      description: "Configure the language model used for chat responses. Environment variables take precedence over these settings.",
    },
    embedding: {
      title: "Embedding Configuration",
      description: "Configure the embedding model used for semantic search. Environment variables take precedence over these settings.",
    },
    auth: {
      title: "Authentication Settings",
      description: "Configure authentication providers and registration settings.",
    },
    quotas: {
      title: "Default Quotas",
      description: "Set default resource limits for new tenants. Existing tenants are not affected.",
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

      {/* Info Box */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <svg className="w-5 h-5 text-blue-400 mr-3 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <h3 className="text-sm font-medium text-blue-800">Environment Variable Priority</h3>
            <p className="mt-1 text-sm text-blue-700">
              Settings configured via environment variables (e.g., <code className="bg-blue-100 px-1 rounded">LLM_API_KEY</code>) will always take precedence over values stored in the database.
              This allows production deployments to securely manage secrets without exposing them in the UI.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
