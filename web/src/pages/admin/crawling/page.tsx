/* Crawl domains (admin portal): teams' domain requests (first) and the platform crawl allowlist. */
import { useQuery } from "@tanstack/react-query";
import { Globe, Inbox } from "lucide-react";
import { PageTabs, useUrlTab } from "@/components/page-tabs";
import { Alert } from "@/components/ui/alert/alert";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { crawlDomainTabs } from "@/lib/tabs";
import { terms } from "@/lib/terms";
import s from "../../shared.module.css";
import { useIsPlatformAdmin } from "../hooks";
import { AllowlistCard } from "./allowlist";
import { DomainRequestsCard, pendingDomainRequestsQuery } from "./requests";

export function CrawlingPage() {
  const isAdmin = useIsPlatformAdmin();
  const [tab, setTab] = useUrlTab(crawlDomainTabs);
  const pending = useQuery(pendingDomainRequestsQuery());
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title={terms.crawlDomains}
        description="Which hosts web sources may crawl. Every team may crawl hosts on the allowlist. Teams request other domains, and platform admins review the requests here. The crawler never fetches private, loopback, link-local or cloud metadata addresses, including host names that resolve to them, so those can't be added."
      />
      {!isAdmin && <Alert tone="info">Auditors can view the allowlist and domain requests. Only platform admins can change them.</Alert>}
      <PageTabs
        label="Crawl domain sections"
        value={tab}
        onValueChange={setTab}
        tabs={[
          {
            value: "requests",
            label: "Requests",
            icon: <Inbox aria-hidden />,
            count: pending.data?.length || undefined,
            content: <DomainRequestsCard isAdmin={isAdmin} />,
          },
          { value: "allowlist", label: "Allowlist", icon: <Globe aria-hidden />, content: <AllowlistCard isAdmin={isAdmin} /> },
        ]}
      />
    </Stack>
  );
}
