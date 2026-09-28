/* An audit log with its filter bar, for a flush card (team Audit log tab, admin Audit log page). */
import { useState } from "react";
import { AuditLog } from "./audit-log";
import { AuditFilterBar, type AuditFilterState, noAuditFilters, toAuditFilters } from "./filters";
import type { AuditScope } from "./target";

export function FilteredAuditLog({ scope }: { scope: AuditScope }) {
  const [filters, setFilters] = useState<AuditFilterState>(noAuditFilters);
  return (
    <>
      <AuditFilterBar scope={scope} value={filters} onChange={setFilters} />
      <AuditLog scope={scope} filters={toAuditFilters(filters)} />
    </>
  );
}
