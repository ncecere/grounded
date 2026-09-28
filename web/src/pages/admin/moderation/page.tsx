/*
 * Admin → Moderation (docs/phase4-publishing.md §4 and §10, ADR-0019, Q8):
 * pill tabs at the top, one per audience policy and Providers; the test box
 * is a dialog opened from the header that judges against the current tab's
 * policy.
 */
import { useQueries } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { PageTabs, useUrlTab } from "@/components/page-tabs";
import { Button } from "@/components/ui/button/button";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { Loading } from "@/components/ui/spinner/spinner";
import { audienceTabs, isModerationProvider } from "@/lib/moderation";
import { moderationTabs } from "@/lib/tabs";
import s from "../../shared.module.css";
import { useIsPlatformAdmin } from "../hooks";
import { useModels } from "../models/common";
import { PolicyEditor } from "./policy-editor";
import { ProvidersTab } from "./providers";
import { TestDialog } from "./test-box";

type Audience = Schemas["Audience"];
type Policy = Schemas["ModerationPolicy"];

export const policyQuery = (audience: Audience) => ({
  queryKey: ["admin", "moderation", "policy", audience],
  queryFn: async () => unwrap(await api.GET("/v1/admin/moderation/policies/{audience}", { params: { path: { audience } } })),
});

export function ModerationPage() {
  const isAdmin = useIsPlatformAdmin();
  const models = useModels();
  const [tab, setTab] = useUrlTab(moderationTabs);
  const [testing, setTesting] = useState(false);
  const policies = useQueries({ queries: audienceTabs.map((t) => policyQuery(t.value)) });
  const providers = (models.data ?? []).filter(isModerationProvider);
  const byAudience = new Map(policies.map((q, i) => [audienceTabs[i]!.value, q.data]));
  const current = tab === "providers" ? undefined : byAudience.get(tab);

  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="Moderation"
        description="A moderation provider checks questions and answers under a policy for each audience: required for public agents, optional for the others. Agents can only make their audience's policy stricter."
        actions={
          isAdmin &&
          providers.length > 0 && (
            <Button variant="secondary" onClick={() => setTesting(true)}>
              <FlaskConical aria-hidden /> Test a provider
            </Button>
          )
        }
      />
      <PageTabs
        label="Moderation sections"
        value={tab}
        onValueChange={setTab}
        tabs={[
          ...audienceTabs.map((t) => ({
            value: t.value,
            label: t.label,
            content: <AudiencePolicy key={t.value} policy={byAudience.get(t.value)} providers={providers} isAdmin={isAdmin} />,
          })),
          { value: "providers" as const, label: "Providers", content: <ProvidersTab models={models} providers={providers} byAudience={byAudience} /> },
        ]}
      />
      {testing && <TestDialog providers={providers} policy={current} onClose={() => setTesting(false)} />}
    </Stack>
  );
}

function AudiencePolicy({ policy, providers, isAdmin }: { policy?: Policy; providers: Schemas["Model"][]; isAdmin: boolean }) {
  if (!policy) return <Loading label="Loading the policy…" />;
  // Keyed by revision so a save or a reload starts a fresh form.
  return <PolicyEditor key={policy.revision} policy={policy} providers={providers} isAdmin={isAdmin} />;
}
