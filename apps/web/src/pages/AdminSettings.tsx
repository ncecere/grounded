import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { FormSection } from "@/components/ui/form-section";
import { InfoBox } from "@/components/ui/info-box";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Key,
  BarChart3,
  Mail,
  Bell,
  Info,
  KeyRound,
  Settings,
} from "lucide-react";
import { SettingsSection } from "./admin-settings/SettingsSection";
import { EmailTestSection } from "./admin-settings/EmailTestSection";
import { FairnessMetricsSection } from "./admin-settings/FairnessMetricsSection";
import { AdminTokensSection } from "./admin-settings/AdminTokensSection";

type SettingsTab = "auth" | "quotas" | "email" | "alerts" | "workers" | "tokens";

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
    workers: {
      title: "Worker Settings",
      description: "Tune worker fairness and throughput behavior.",
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
          <TabsTrigger value="workers" className="gap-2">
            <Settings className="w-4 h-4" />
            Workers
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
        </TabsContent>

        <TabsContent value="workers">
          <SettingsSection
            title={tabDescriptions.workers.title}
            description={tabDescriptions.workers.description}
            settings={filteredSettings}
            onUpdate={handleUpdate}
            isUpdating={updateMutation.isPending}
          />
          <FairnessMetricsSection />
        </TabsContent>

        <TabsContent value="tokens">
          <FormSection title={tabDescriptions.tokens.title} description={tabDescriptions.tokens.description}>
            <AdminTokensSection />
          </FormSection>
        </TabsContent>
      </Tabs>
    </div>
  );
}
