/* A team picker for admin dialogs: a Combobox that searches every team by name or slug, and keeps the chosen one listed. */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox/combobox";
import { useDebounced } from "./hooks";

/** Teams matching the typed text (their slug is the value), at most 20. */
function useTeamOptions(text: string): ComboboxOption[] {
  const q = useDebounced(text.trim(), 250);
  const teams = useQuery({
    queryKey: ["admin", "teams", "picker", q],
    queryFn: async () => unwrap(await api.GET("/v1/admin/teams", { params: { query: { q: q || undefined, limit: 20 } } })),
  });
  return (teams.data?.items ?? []).map(({ team: t }) => ({ value: t.slug, label: t.name, hint: t.slug }));
}

/** Put it in a Field for its label and error; `value` is the chosen team's slug ("" for none). */
export function TeamPicker({ value, onChange }: { value: string; onChange: (slug: string) => void }) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<ComboboxOption | null>(null);
  const options = useTeamOptions(text);
  const items = picked && !options.some((o) => o.value === picked.value) ? [picked, ...options] : options;
  return (
    <Combobox
      items={items}
      value={value || null}
      onValueChange={(v, option) => {
        onChange(v ?? "");
        setPicked(option);
      }}
      onInputValueChange={setText}
      placeholder="Search teams"
      emptyText="No team matches."
      autoHighlight
    />
  );
}
