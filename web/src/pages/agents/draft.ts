/*
 * The agent editor's local draft and autosave. Edits change local state at
 * once and are saved after a pause (PATCH with If-Match: the agent's
 * revision). A save that finds the agent changed elsewhere (412) loads the
 * latest version but keeps the user's edits, pauses autosave and asks
 * "Keep mine" (re-apply the edits on top of the latest revision) or "Use
 * theirs" (conflict.ts; docs/ui-review F-04). Values the API would refuse
 * (an accent colour below 4.5:1, an invalid address) are held back until
 * fixed.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, ifMatch, unwrap, type Schemas } from "../../api/client";
import { contrastRatio, normalizeHex } from "@/components/ui/color-field/color-field";
import { agentKey, agentQuery, agentsKey } from "../team/common";
import { ACCENT_TEXT, DEFAULT_ACCENT } from "./accents.colors";
import { type Agent, type AgentConfig, type AgentProblem, configInput } from "./common";
import { type Conflict, changedFields, reapply } from "./conflict";

type Profile = {
  name: string;
  slug: string;
  description: string;
  accentColor: string;
  welcomeMessage: string;
  starterQuestions: string[];
};

type DraftState = { profile: Profile; config: AgentConfig };

export type DraftConflict = Conflict<Profile, AgentConfig>;

/** conflict: the agent changed elsewhere; nothing saves until the user chooses. */
type SaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";

const draftOf = (a: Agent): DraftState => ({
  profile: {
    name: a.name,
    slug: a.slug,
    description: a.description,
    accentColor: a.accentColor,
    welcomeMessage: a.welcomeMessage,
    starterQuestions: a.starterQuestions.length ? [...a.starterQuestions] : [],
  },
  config: a.draft,
});

const slugOK = (v: string) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(v);

/** Why a profile value can't be saved yet, by field. */
export function profileErrors(p: Profile): Partial<Record<keyof Profile, string>> {
  const e: Partial<Record<keyof Profile, string>> = {};
  if (!p.name.trim()) e.name = "Enter a name.";
  if (!slugOK(p.slug)) e.slug = "Use lower-case letters, digits and hyphens (not at the start or end).";
  if (p.accentColor) {
    const hex = normalizeHex(p.accentColor);
    if (!hex) e.accentColor = `Enter a hex colour such as ${DEFAULT_ACCENT}.`;
    else if ((contrastRatio(hex, ACCENT_TEXT) ?? 0) < 4.5) e.accentColor = "White text on this colour is below 4.5:1. Choose a darker colour.";
  }
  if (p.starterQuestions.some((q) => q.length > 200)) e.starterQuestions = "Keep each question under 200 characters.";
  return e;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const starters = (list: string[]) => list.map((q) => q.trim()).filter(Boolean);

/** The PATCH body for what changed (valid values only), and whether invalid values were held back. */
function changes(base: Agent, d: DraftState): { body: Schemas["AgentUpdate"] | null; held: boolean } {
  const body: Schemas["AgentUpdate"] = {};
  const errs = profileErrors(d.profile);
  const p = d.profile;
  let held = false;
  const take = <K extends keyof Profile>(k: K, value: Schemas["AgentUpdate"][K & keyof Schemas["AgentUpdate"]], baseValue: unknown) => {
    if (same(value, baseValue)) return;
    if (errs[k]) held = true;
    else (body as Record<string, unknown>)[k] = value;
  };
  take("name", p.name.trim(), base.name);
  take("slug", p.slug, base.slug);
  take("description", p.description, base.description);
  take("accentColor", p.accentColor ? normalizeHex(p.accentColor) ?? p.accentColor : "", base.accentColor);
  take("welcomeMessage", p.welcomeMessage, base.welcomeMessage);
  take("starterQuestions", starters(p.starterQuestions), base.starterQuestions);
  if (!same(configInput(d.config), configInput(base.draft))) body.config = configInput(d.config);
  return { body: Object.keys(body).length ? body : null, held };
}

export function useAgentDraft(team: string, agent: Agent, delay = 800) {
  const qc = useQueryClient();
  const [draft, setDraftState] = useState<DraftState>(() => draftOf(agent));
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<unknown>(null);
  const [problems, setProblems] = useState<AgentProblem[]>([]);
  /** After a 412 with local edits: the user's draft, the latest version and where both started. */
  const [conflict, setConflictState] = useState<DraftConflict | null>(null);
  const conflictRef = useRef<DraftConflict | null>(null);
  const setConflict = useCallback((c: DraftConflict | null) => {
    conflictRef.current = c;
    setConflictState(c);
  }, []);
  /** Increases when the draft is replaced from the server (revert, reload), so forms re-read it. */
  const [epoch, setEpoch] = useState(0);
  /** Fields holding text that isn't a valid value yet (it isn't in the draft, so it isn't saved: F-26). */
  const [invalidFields, setInvalidFields] = useState<string[]>([]);
  const reportInvalid = useCallback((id: string, invalid: boolean) => {
    setInvalidFields((list) => (invalid === list.includes(id) ? list : invalid ? [...list, id] : list.filter((x) => x !== id)));
  }, []);
  const base = useRef(agent);
  const draftRef = useRef(draft);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const replace = useCallback((next: DraftState) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  /** Takes a newer server copy (after publish, revert or a status change). resetDraft also replaces local edits. */
  const adopt = useCallback(
    (next: Agent, resetDraft = false) => {
      base.current = next;
      qc.setQueryData(agentKey(team, next.id), next);
      qc.invalidateQueries({ queryKey: agentsKey(team) });
      if (resetDraft) {
        setConflict(null);
        replace(draftOf(next));
        setEpoch((e) => e + 1);
        setStatus("saved");
        setProblems([]);
        setError(null);
      }
    },
    [qc, team, replace, setConflict],
  );

  const save = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    if (conflictRef.current) {
      setStatus("conflict");
      return;
    }
    if (inflight.current) {
      again.current = true;
      return inflight.current;
    }
    const { body } = changes(base.current, draftRef.current);
    if (!body) {
      setStatus("saved");
      return;
    }
    setStatus("saving");
    const run = (async () => {
      try {
        const res = unwrap(
          await api.PATCH("/v1/teams/{team}/agents/{agentId}", {
            params: { path: { team, agentId: base.current.id }, header: ifMatch(base.current.revision) },
            body,
          }),
        );
        base.current = res;
        qc.setQueryData(agentKey(team, res.id), res);
        void qc.invalidateQueries({ queryKey: agentsKey(team), refetchType: "none" });
        setProblems([]);
        setError(null);
        setStatus(changes(res, draftRef.current).body ? "dirty" : "saved");
      } catch (err) {
        again.current = false;
        if (err instanceof ApiError && err.status === 412) {
          try {
            const from = draftOf(base.current);
            const fresh = await qc.fetchQuery({ ...agentQuery(team, base.current.id), staleTime: 0 });
            base.current = fresh;
            setError(null);
            const theirs = draftOf(fresh);
            const c: DraftConflict = { from, mine: draftRef.current, theirs };
            if (changedFields(from, c.mine).length === 0 || same(reapply(c), theirs)) {
              // Nothing of the user's is lost: take the latest version.
              replace(theirs);
              setEpoch((e) => e + 1);
              setStatus("saved");
            } else {
              setConflict(c); // the form keeps the user's text meanwhile
              setStatus("conflict");
            }
          } catch (reloadErr) {
            setError(reloadErr);
            setStatus("error");
          }
          return;
        }
        const details = err instanceof ApiError ? (err.details as { problems?: AgentProblem[] } | undefined) : undefined;
        setProblems(details?.problems ?? []);
        setError(err);
        setStatus("error");
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    await run;
    if (again.current) {
      again.current = false;
      await save();
    }
  }, [qc, team, replace]);

  /** Changes the local draft and schedules a save. */
  const update = useCallback(
    (fn: (d: DraftState) => DraftState) => {
      replace(fn(draftRef.current));
      setStatus("dirty");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), delay);
    },
    [replace, save, delay],
  );

  const setConfig = useCallback((patch: Partial<AgentConfig>) => update((d) => ({ ...d, config: { ...d.config, ...patch } })), [update]);
  const setProfile = useCallback((patch: Partial<Profile>) => update((d) => ({ ...d, profile: { ...d.profile, ...patch } })), [update]);

  /** Saves now and waits (before publishing or testing). */
  const flush = useCallback(async () => {
    await save();
    if (inflight.current) await inflight.current;
  }, [save]);

  // Warn before leaving with unsaved edits; save what's pending on unmount.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (changes(base.current, draftRef.current).body) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      if (changes(base.current, draftRef.current).body) void save();
      clearTimeout(timer.current);
    };
  }, [save]);

  /** "Keep mine": re-applies the user's edits on top of the latest version and saves. */
  const keepMine = useCallback(async () => {
    const c = conflictRef.current;
    if (!c) return;
    setConflict(null);
    replace(reapply({ ...c, mine: draftRef.current }));
    setEpoch((e) => e + 1);
    await save();
  }, [replace, save, setConflict]);

  /** "Use theirs": drops the user's edits for the latest version. */
  const takeTheirs = useCallback(() => {
    const c = conflictRef.current;
    if (!c) return;
    setConflict(null);
    replace(draftOf(base.current));
    setEpoch((e) => e + 1);
    setStatus("saved");
  }, [replace, setConflict]);

  const held = changes(base.current, draft).held;
  return {
    draft,
    epoch,
    status,
    error,
    problems,
    held,
    conflict,
    keepMine,
    takeTheirs,
    invalidFields,
    reportInvalid,
    setConfig,
    setProfile,
    flush,
    adopt,
    base: base.current,
  };
}

export type AgentDraft = ReturnType<typeof useAgentDraft>;
