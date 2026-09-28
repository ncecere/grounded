/*
 * Admin → Public access (docs/phase4-publishing.md §7 and §10): the platform's
 * switch for public agents, the visitor safeguards (CAPTCHA, anonymous
 * sessions) and links to the public agents and to Limits › Public agents,
 * the one place the public limits are shown and edited (Q9).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { api, ifMatch, unwrap } from "@/api/client";
import { QueryView } from "@/components/query-view";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { DescriptionList } from "@/components/ui/description-list/description-list";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { Loading } from "@/components/ui/spinner/spinner";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { platformLimitsQuery } from "@/lib/limits";
import s from "../../shared.module.css";
import { adminAgentsQuery } from "../agents/agents";
import { useIsPlatformAdmin } from "../hooks";
import p from "./public-access.module.css";

const settingsKey = ["admin", "public-access"];

export function PublicAccessPage() {
  const isAdmin = useIsPlatformAdmin();
  const settings = useQuery({ queryKey: settingsKey, queryFn: async () => unwrap(await api.GET("/v1/admin/settings/public-access")) });
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="Public access"
        description="Whether teams' public agents answer anonymous visitors on their public pages and through the widget. Teams publish to the public themselves, within their data classification and with public moderation in place."
      />
      <QueryView query={settings} loadingLabel="Loading settings…">
        {settings.data && (
          <>
            <SwitchCard enabled={settings.data.publicAgentsEnabled} revision={settings.data.revision} isAdmin={isAdmin} />
            <Card title="Visitor safeguards" description="Set in the server configuration.">
              <DescriptionList
                dividers
                items={[
                  {
                    label: "Visitor verification (CAPTCHA)",
                    value:
                      settings.data.captcha.provider === "turnstile" ? (
                        <>
                          <StatusBadge tone="success">Cloudflare Turnstile</StatusBadge> Site key <span className={s.mono}>{settings.data.captcha.siteKey}</span>
                        </>
                      ) : (
                        <>
                          <StatusBadge tone="neutral">Off</StatusBadge> Visitors aren't asked to verify; rate limits and daily caps still apply.
                        </>
                      ),
                  },
                  { label: "Anonymous sessions end", value: `${hours(settings.data.anonSessionTtlSeconds)} after the last question` },
                  { label: "Anonymous conversations", value: <>Deleted after their classification's <Link to="/admin/classifications">anonymous retention</Link></> },
                  { label: "Configured by", value: <span className={s.mono}>CAPTCHA_PROVIDER, TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY, ANON_SESSION_TTL</span> },
                ]}
              />
            </Card>
          </>
        )}
      </QueryView>
      <PublicSummary />
    </Stack>
  );
}

const hours = (secs: number) => (secs % 3600 === 0 ? `${secs / 3600} hours` : `${Math.round(secs / 60)} minutes`);

function SwitchCard({ enabled, revision, isAdmin }: { enabled: boolean; revision: number; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [confirmOff, setConfirmOff] = useState(false);
  // F-23: turning it off stops every public agent at once, so name them first.
  const agents = useQuery({ ...adminAgentsQuery("", "active"), enabled: confirmOff });
  const affected = (agents.data ?? []).filter((a) => a.audience === "public" && a.publishedVersion !== null);
  const save = useMutation({
    mutationFn: async (on: boolean) =>
      unwrap(await api.PUT("/v1/admin/settings/public-access", { params: { header: ifMatch(revision) }, body: { publicAgentsEnabled: on } })),
    onSuccess: (st) => {
      setConfirmOff(false);
      qc.setQueryData(settingsKey, st);
      toast.success(st.publicAgentsEnabled ? "Public agents are on" : "Public agents are off");
    },
  });
  return (
    <Card
      title="Public agents"
      description="Off: public pages, embeds and the public API refuse, and the directory hides public agents. Published agents keep their audience, so turning it back on restores them. Changes are audited."
    >
      <Stack gap={3}>
        <Switch
          label="Allow public agents"
          description={enabled ? "Anonymous visitors can chat with public agents." : "Nobody can chat with public agents without signing in."}
          checked={enabled}
          disabled={!isAdmin || save.isPending}
          onCheckedChange={(v) => (v ? save.mutate(true) : setConfirmOff(true))}
        />
        {!enabled && (
          <Alert tone="warning" title="Public agents are off">
            Public pages, embedded widgets and the public API refuse every visitor. Published public agents keep their audience and come back when you turn this on.
          </Alert>
        )}
        {!confirmOff && <ErrorAlert error={save.error} />}
      </Stack>
      <AlertDialog
        open={confirmOff}
        onOpenChange={(o) => {
          if (!o) {
            setConfirmOff(false);
            save.reset();
          }
        }}
        title="Turn off public agents?"
        description="Anonymous visitors can't chat with any public agent until you turn this back on: public pages, embedded widgets and the public API refuse."
        confirmLabel="Turn off public agents"
        busy={save.isPending}
        error={save.error}
        onConfirm={() => save.mutate(false)}
      >
        {agents.isLoading ? (
          <Loading label="Finding the public agents…" />
        ) : affected.length === 0 ? (
          <p className={s.settingDescription}>No published agent is public right now.</p>
        ) : (
          <>
            <p className={s.settingDescription}>
              {affected.length === 1 ? "This agent stops answering visitors:" : `These ${affected.length} agents stop answering visitors:`}
            </p>
            <ul className={p.affected}>
              {affected.map((a) => (
                <li key={a.id}>
                  <strong>{a.name}</strong> <span className={s.muted}>({a.teamName})</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </AlertDialog>
    </Card>
  );
}

/** How many agents are public, and a link to the public limits (edited only on Limits › Public agents, Q9). */
function PublicSummary() {
  const limits = useQuery(platformLimitsQuery());
  const agents = useQuery(adminAgentsQuery());
  const published = (agents.data ?? []).filter((a) => a.audience === "public" && a.publishedVersion !== null).length;
  const custom = (limits.data?.items ?? []).filter((it) => it.group === "public" && it.custom).length;
  return (
    <Card title="Public agents and limits">
      <DescriptionList
        dividers
        items={[
          {
            label: "Published public agents",
            value: (
              <span className={p.row}>
                {agents.isLoading ? "…" : published.toLocaleString()}
                <Button variant="link" size="sm" render={<Link to="/admin/agents" search={{ audience: "public" }} />}>
                  View public agents <ArrowRight aria-hidden />
                </Button>
              </span>
            ),
          },
          {
            label: "Public limits",
            value: (
              <span className={p.row}>
                {limits.isLoading ? "…" : custom ? `${custom} changed from the built-in defaults` : "Built-in defaults"}
                <Button variant="link" size="sm" render={<Link to="/admin/limits" search={{ tab: "public" }} />}>
                  Change public limits <ArrowRight aria-hidden />
                </Button>
              </span>
            ),
          },
        ]}
      />
    </Card>
  );
}
