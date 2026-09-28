/*
 * The maintenance banner (docs/phase5-deploy.md §5 P5): above every page for
 * platform admins and team owners, admins and editors while maintenance mode
 * is on. Members and chat users don't see it (the shell leaves it off chat
 * pages); they only meet the reason if something they do is refused.
 */
import { Link } from "@tanstack/react-router";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { concernsMaintenance, plannedEndText, useMaintenance } from "../../lib/maintenance";
import { type Me } from "../../session";
import styles from "./maintenance-banner.module.css";

export function MaintenanceBanner({ me }: { me: Me }) {
  const concerned = concernsMaintenance(me);
  const st = useMaintenance(concerned);
  if (!st) return null;
  const end = plannedEndText(st);
  return (
    <Alert
      tone="warning"
      title="Maintenance: ingestion is paused"
      className={styles.banner}
      actions={
        me.capabilities.platformAdmin ? (
          <Button size="sm" variant="secondary" render={<Link to="/admin/maintenance" />}>
            Manage
          </Button>
        ) : undefined
      }
    >
      <p className={styles.reason}>{st.reason}</p>
      <p className={styles.detail}>
        Uploads, syncs and crawls wait until it ends; chat and search keep working.{end ? ` ${end}` : ""}
      </p>
    </Alert>
  );
}
