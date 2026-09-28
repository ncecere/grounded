/* Admin → Parsing: documents skipped as scanned (needs_ocr), per team, which OCR could now read once they are retried. */
import { ScanLine } from "lucide-react";
import type { Schemas } from "@/api/client";
import { SettingsSection } from "@/components/templates/settings-page";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { documentsCount } from "@/lib/parsing";
import s from "../../shared.module.css";

export function NeedsOcrSection({ counts, ocrOn }: { counts: Schemas["NeedsOcrCount"][]; ocrOn: boolean }) {
  const total = counts.reduce((n, c) => n + c.documents, 0);
  return (
    <SettingsSection
      title="Documents that need OCR"
      description={
        ocrOn
          ? "Documents skipped as scanned before OCR was on. Teams retry them from a source's Documents tab: filter by Needs OCR, then Retry all."
          : "Documents skipped as scanned. Once OCR is on, teams retry them from a source's Documents tab (filter: Needs OCR)."
      }
    >
      {counts.length === 0 ? (
        <EmptyState size="compact" icon={<ScanLine />} title="No documents need OCR." />
      ) : (
        <Table caption={`Documents that need OCR, by team (${documentsCount(total)})`} columns={["Team", { label: "Documents", numeric: true }]}>
          {counts.map((c) => (
            <Tr key={c.teamId ?? "platform"}>
              <Td>{c.teamId ? c.teamName || c.teamSlug : <span className={s.muted}>Shared sources</span>}</Td>
              <Td numeric>{c.documents.toLocaleString()}</Td>
            </Tr>
          ))}
        </Table>
      )}
    </SettingsSection>
  );
}
