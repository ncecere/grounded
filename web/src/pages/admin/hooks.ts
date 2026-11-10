import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, unwrap } from "../../api/client";
import { classificationsQuery } from "../../api/queries";
import type { FilterValues } from "@/components/ui/filter-bar/filter-bar";
import { useCurrentUser } from "../../session";

export function useIsPlatformAdmin() {
  return useCurrentUser().capabilities.platformAdmin;
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useClassifications() {
  return useQuery(classificationsQuery());
}

/** A list facet's single value ("" when unset). */
export const one = (values: FilterValues, id: string) => {
  const v = values[id];
  return Array.isArray(v) ? (v[0] ?? "") : "";
};

export const adminProfilesKey = ["admin", "profiles"];

/** Every embedding profile, as platform staff see them: the one definition (the Profiles tab, the migration dialogs, the Overview, the audit record). */
export const adminProfilesQuery = () =>
  queryOptions({
    queryKey: adminProfilesKey,
    queryFn: async () => unwrap(await api.GET("/v1/admin/embedding-profiles")),
  });
