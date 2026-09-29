/*
 * Admin → Embedding profiles (A5; v0.2.1 I1): pill tabs Profiles · Migrations
 * (?tab=migrations; Admin → Profile migrations until v0.2.1, and its old
 * address redirects here). The header's primary follows the tab: "Add
 * profile" on Profiles, "Migrate a knowledge base" on Migrations (platform
 * admins only).
 */
import { Layers, Plus, Shuffle } from "lucide-react";
import { useState } from "react";
import { PageTabs, useUrlTab } from "@/components/page-tabs";
import { Button } from "@/components/ui/button/button";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { embeddingProfileTabs } from "@/lib/tabs";
import s from "../../shared.module.css";
import { useIsPlatformAdmin } from "../hooks";
import { migrationsDescription, ProfileMigrationsTab } from "../profile-migrations/page";
import { ProfileDialog } from "./profile-dialog";
import { ProfilesTab } from "./profiles";

const profilesDescription =
  "How documents are split into passages and embedded. Sources choose a profile; every source in a knowledge base shares one. Vector settings are fixed once created: to change them, migrate knowledge bases to a new profile.";

export function EmbeddingProfilesPage() {
  const isAdmin = useIsPlatformAdmin();
  const [tab, setTab] = useUrlTab(embeddingProfileTabs);
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState(false);
  const add = isAdmin && (
    <Button onClick={() => setCreating(true)}>
      <Plus aria-hidden /> Add profile
    </Button>
  );
  const start = isAdmin && (
    <Button onClick={() => setStarting(true)}>
      <Plus aria-hidden /> Migrate a knowledge base
    </Button>
  );
  const onMigrations = tab === "migrations";
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader title="Embedding profiles" description={onMigrations ? migrationsDescription : profilesDescription} actions={onMigrations ? start : add} />
      <PageTabs
        label="Embedding profile sections"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "profiles", label: "Profiles", icon: <Layers aria-hidden />, content: <ProfilesTab isAdmin={isAdmin} add={add} /> },
          {
            value: "migrations",
            label: "Migrations",
            icon: <Shuffle aria-hidden />,
            content: <ProfileMigrationsTab isAdmin={isAdmin} starting={starting} onStartClosed={() => setStarting(false)} start={start} />,
          },
        ]}
      />
      {creating && <ProfileDialog onClose={() => setCreating(false)} />}
    </Stack>
  );
}
