/*
 * What a team role may do, said the same way on every team page (VI-20,
 * VI-20b): a read-only notice is one untitled info alert, "Members can view
 * knowledge bases. Editors, admins and owners can change them.", and a page
 * only editors can open tells others so instead of "Page not found".
 */
import { Link } from "@tanstack/react-router";
import { Home, Lock } from "lucide-react";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { roleLabels } from "../../components/roles";
import s from "../shared.module.css";
import { useTeam } from "./common";

/** "Members can view knowledge bases. Editors, admins and owners can change them." */
export function readOnlyText(role: keyof typeof roleLabels, what: string, who = "Editors, admins and owners", change = "change them") {
  return `${roleLabels[role]}s can view ${what}. ${who} can ${change}.`;
}

/**
 * The read-only notice for a team member who can't change `what` (nothing for those who can, an archived
 * team, which has its own notice, or platform staff without a role).
 */
export function ReadOnlyNotice({ what, managers = false, change }: { what: string; managers?: boolean; change?: string }) {
  const { role, canEdit, isManager, archived } = useTeam();
  if (!role || archived || (managers ? isManager : canEdit)) return null;
  return <Alert tone="info">{readOnlyText(role, what, managers ? "Admins and owners" : undefined, change)}</Alert>;
}

/** A page only editors, admins and owners open, reached by someone else (a member following a link). */
export function EditorsOnlyState({ title, what }: { title: string; what: string }) {
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader title={title} />
      <Card>
        <EmptyState
          icon={<Lock />}
          title={`Only editors, admins and owners can see ${what}.`}
          description="Ask a team admin or owner if you need access."
          action={
            <Button variant="secondary" render={<Link to="/" />}>
              <Home aria-hidden /> Go home
            </Button>
          }
        />
      </Card>
    </Stack>
  );
}
