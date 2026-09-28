import { useQueryClient } from "@tanstack/react-query";
import { type DataSource, useSourceOwner } from "./owner";

export function useInvalidateSource(source: DataSource) {
  const owner = useSourceOwner();
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: owner.keys.source(source.id) });
    qc.invalidateQueries({ queryKey: owner.keys.list });
    for (const key of owner.keys.related) qc.invalidateQueries({ queryKey: key });
  };
}
