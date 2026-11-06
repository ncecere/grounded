/*
 * A team source's Access tab (B6, #41; docs/document-permissions.md): everyone who can use the knowledge, or only some
 * groups and people. A restricted source's documents are read, searched and cited only for those groups and people;
 * editors still manage the source and see its documents' names. Saving applies to every document at once (If-Match,
 * audited as source.access_update). Restricting needs a platform admin to have turned document permissions on.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { Field } from "@/components/ui/field/field";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { TagInput } from "@/components/ui/tag-input/tag-input";
import { toast } from "@/components/ui/toast/toast";
import { useInvalidateSource } from "./invalidate";
import type { DataSource } from "./owner";
import s from "./access.module.css";

type Mode = "everyone" | "restricted";

/** The groups and email addresses of a restriction (people chosen by id are kept as they are). */
export function splitPrincipals(principals: string[]) {
  const pick = (kind: string) => principals.filter((p) => p.startsWith(kind + ":")).map((p) => p.slice(kind.length + 1));
  return { groups: pick("group"), emails: pick("email"), others: principals.filter((p) => !/^(group|email):/.test(p)) };
}

/** A short sentence of who may read a source, for its header and lists. */
export function accessSummary(principals: string[]) {
  const { groups, emails, others } = splitPrincipals(principals);
  const n = groups.length + emails.length + others.length;
  return n === 0 ? "Nobody" : `${n} ${n === 1 ? "group or person" : "groups and people"}`;
}

export function SourceAccess({ source, team }: { source: DataSource; team: string }) {
  const invalidate = useInvalidateSource(source);
  const current = source.access ?? { restricted: false, principals: [] };
  const initial = splitPrincipals(current.principals);
  const [mode, setMode] = useState<Mode>(current.restricted ? "restricted" : "everyone");
  const [groups, setGroups] = useState(initial.groups);
  const [emails, setEmails] = useState(initial.emails);
  // A change saved elsewhere (or by this form) resets it.
  useEffect(() => {
    const next = splitPrincipals(source.access?.principals ?? []);
    setMode(source.access?.restricted ? "restricted" : "everyone");
    setGroups(next.groups);
    setEmails(next.emails);
  }, [source.revision, source.access?.restricted, source.access?.principals]);

  const known = useQuery({
    queryKey: ["teams", team, "access-groups"],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/access/groups", { params: { path: { team } } })),
    enabled: mode === "restricted",
    staleTime: 60_000,
  });
  const principals =
    mode === "everyone" ? null : [...groups.map((g) => `group:${g}`), ...emails.map((e) => `email:${e}`), ...initial.others];
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PUT("/v1/teams/{team}/sources/{sourceId}/access", {
          params: { path: { team, sourceId: source.id }, header: ifMatch(source.revision) },
          body: { principals },
        }),
      ),
    onSuccess: (src) => {
      invalidate();
      toast.success(src.access?.restricted ? "Access saved: only the groups and people you chose can read this source" : "Access saved: everyone who can use the knowledge can read this source");
    },
  });
  const empty = mode === "restricted" && groups.length + emails.length + initial.others.length === 0;
  const unchanged = JSON.stringify(principals) === JSON.stringify(current.restricted ? current.principals : null);
  const suggestions = (known.data ?? []).filter((g) => !groups.includes(g)).slice(0, 12);

  return (
    <Card title="Who can read this source" description="Applies to every document of the source, now and when new ones are added.">
      <div className={s.stack}>
        <RadioGroup<Mode>
          legend="Access"
          value={mode}
          onValueChange={setMode}
          options={[
            {
              value: "everyone",
              label: "Everyone who can use the knowledge",
              description: "Anyone who can ask an agent or search a knowledge base that uses this source.",
            },
            {
              value: "restricted",
              label: "Only some groups and people",
              description:
                "Its documents are searched, used in answers and opened only for them. Agents answer everyone else without them; public pages, widgets and API keys never use them.",
            },
          ]}
        />
        {mode === "restricted" && (
          <>
            <Field label="Groups" description="As your identity provider names them (the groups sent at sign-in or by SCIM). Press Enter after each.">
              <TagInput value={groups} onValueChange={setGroups} noun={{ one: "group", other: "groups" }} maxTags={50} maxTagLength={256} normalize={(t) => t.trim().toLowerCase()} />
            </Field>
            {suggestions.length > 0 && (
              <div className={s.suggestions} role="group" aria-label="Groups seen at sign-in">
                <span className={s.hint}>Seen at sign-in:</span>
                {suggestions.map((g) => (
                  <Button key={g} size="sm" variant="secondary" onClick={() => setGroups([...groups, g])} aria-label={`Add group ${g}`}>
                    {g}
                  </Button>
                ))}
              </div>
            )}
            <Field label="People" labelHint="Optional" description="Email addresses, matched only when the identity provider has verified them.">
              <TagInput value={emails} onValueChange={setEmails} noun={{ one: "email address", other: "email addresses" }} maxTags={50} maxTagLength={256} normalize={(t) => t.trim().toLowerCase()} placeholder="name@example.edu" />
            </Field>
            {empty && <Alert tone="warning">Add at least one group or person, or choose Everyone.</Alert>}
          </>
        )}
        {save.error && <ErrorAlert error={save.error} title="Access wasn't saved" />}
        <div className={s.actions}>
          <Button loading={save.isPending} disabled={empty || unchanged} onClick={() => save.mutate()}>
            Save access
          </Button>
        </div>
      </div>
    </Card>
  );
}
