/*
 * Notification settings (/settings/notifications): every event with an
 * in-app and an email switch. Mandatory events are shown on and locked.
 * Each change saves at once and says "Saved" next to the row (P-20).
 */
import { useQuery } from "@tanstack/react-query";
import { Check, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { errorMessage } from "../../api/client";
import { QueryView } from "../../components/query-view";
import { notificationSettingsQuery, type NotificationSetting, useSaveNotificationSetting } from "../../components/notifications/api";
import { Alert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Card } from "@/components/ui/card/card";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { Switch } from "@/components/ui/switch/switch";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { toast } from "@/components/ui/toast/toast";
import { VisuallyHidden } from "@/components/ui/visually-hidden/visually-hidden";
import s from "../shared.module.css";
import styles from "./notifications.module.css";

export function NotificationSettingsPage() {
  const q = useQuery(notificationSettingsQuery());
  const emailEnabled = q.data?.emailEnabled ?? true;
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader title="Notification settings" description="Choose how you hear about each kind of event. Changes are saved right away." />
      {q.data && !emailEnabled && (
        <Alert tone="info" title="Email isn't set up">
          This instance doesn't send email, so notifications only appear in the app.
        </Alert>
      )}
      <Card flush>
        <QueryView query={q} loadingLabel="Loading settings…">
          <Table caption="Notification settings" columns={["Notification", { label: "In the app", width: "8rem" }, { label: "Email", width: "8rem" }]}>
            {(q.data?.items ?? []).map((it) => (
              <SettingRow key={it.type} it={it} emailEnabled={emailEnabled} />
            ))}
          </Table>
        </QueryView>
      </Card>
      <p className={styles.note}>
        <Lock aria-hidden className={styles.noteIcon} />
        {emailEnabled
          ? "Required notifications concern access to your teams and the safety of their data, so they're always sent in the app and by email."
          : "Required notifications concern access to your teams and the safety of their data, so they're always shown in the app."}
      </p>
    </Stack>
  );
}

function SettingRow({ it, emailEnabled }: { it: NotificationSetting; emailEnabled: boolean }) {
  const save = useSaveNotificationSetting();
  // A small "Saved" after each change (P-20), announced politely, gone after a few seconds.
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(t);
  }, [saved]);
  const update = (change: Partial<Pick<NotificationSetting, "inApp" | "email">>) => {
    setSaved(false);
    save.mutate(
      { type: it.type, inApp: it.inApp, email: it.email, ...change },
      { onSuccess: () => setSaved(true), onError: (err) => toast.error("Couldn't save the setting", errorMessage(err)) },
    );
  };
  const locked = it.mandatory || save.isPending;
  const descId = `notif-${it.type}-desc`;
  return (
    <Tr>
      <Td>
        <span className={s.primary}>{it.label}</span>
        {it.mandatory && (
          <Badge tone="neutral" size="sm" className={styles.required}>
            <Lock aria-hidden /> Required
          </Badge>
        )}
        <span role="status" className={styles.saved}>
          {saved && (
            <>
              <Check aria-hidden /> Saved
            </>
          )}
        </span>
        <span id={descId} className={s.secondary}>
          {it.description}
          {it.mandatory && " Always sent; it can't be turned off."}
        </span>
      </Td>
      <Td>
        <Switch
          label={<VisuallyHidden>In the app: {it.label}</VisuallyHidden>}
          checked={it.inApp}
          disabled={locked}
          aria-describedby={descId}
          onCheckedChange={(v) => update({ inApp: v })}
        />
      </Td>
      <Td>
        <Switch
          label={<VisuallyHidden>Email: {it.label}</VisuallyHidden>}
          checked={emailEnabled && it.email}
          disabled={locked || !emailEnabled}
          aria-describedby={descId}
          onCheckedChange={(v) => update({ email: v })}
        />
      </Td>
    </Tr>
  );
}
