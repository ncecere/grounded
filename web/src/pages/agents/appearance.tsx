/* The Appearance tab: the look and welcome (accent colour, welcome message, starter questions) and a live preview. Name, address and description are in Settings (C13). */
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button, IconButton } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { ColorField } from "@/components/ui/color-field/color-field";
import { Field } from "@/components/ui/field/field";
import { Input, Textarea } from "@/components/ui/input/input";
import { ChatWelcome } from "../chat/welcome";
import { ACCENT_PRESETS, ACCENT_TEXT, themeAccent } from "./accents.colors";
import { useTeam } from "../team/common";
import type { Agent } from "./common";
import { type AgentDraft, profileErrors } from "./draft";
import { liveProfileLocked } from "./publish-state";
import a from "./agents.module.css";
import ap from "./appearance.module.css";

export function AppearanceTab({ agent, d }: { agent: Agent; d: AgentDraft }) {
  const { isManager } = useTeam();
  const locked = liveProfileLocked(agent, isManager);
  const p = d.draft.profile;
  const set = d.setProfile;
  const errors = profileErrors(p);
  const starters = p.starterQuestions;
  const setStarter = (i: number, v: string) => set({ starterQuestions: starters.map((q, j) => (j === i ? v : q)) });
  // No accent: the theme's primary, as in the preview and the chat (G17).
  const [defaultAccent] = useState(themeAccent);

  return (
    <div className={ap.appearance}>
      <div className={a.stack}>
        <p className={ap.liveNote}>
          <Badge tone="info">Live</Badge> Changes here reach people as soon as they're saved. They aren't part of versions.
        </p>
        {locked && <Alert tone="info">{locked}</Alert>}
        <Card title="Look and welcome">
          <div className={a.stack}>
            <Field
              label="Accent colour"
              description={`Used for the agent's avatar and highlights, always with white text. Leave it empty for the theme's colour, ${defaultAccent}.`}
              // The colour field says what's wrong itself (its contrast line): marked invalid, not said twice (BU-13).
              invalid={Boolean(errors.accentColor)}
            >
              <ColorField
                disabled={Boolean(locked)}
                value={p.accentColor}
                onValueChange={(accentColor) => set({ accentColor })}
                defaultColor={defaultAccent}
                contrastWith={ACCENT_TEXT}
                contrastLabel="white text"
                presets={ACCENT_PRESETS}
              />
            </Field>
            <Field label="Welcome message" labelHint="Optional" description={`${p.welcomeMessage.length} / 1,000 characters. Shown before the first question.`}>
              <Textarea rows={3} maxLength={1000} disabled={Boolean(locked)} value={p.welcomeMessage} onChange={(e) => set({ welcomeMessage: e.target.value })} />
            </Field>
            <fieldset className={ap.starters}>
              <legend className={ap.legend}>Starter questions</legend>
              <p className={ap.legendHint}>Up to 6 suggestions people can click to start. Empty ones are ignored.</p>
              {starters.map((q, i) => (
                <div key={i} className={ap.starterRow}>
                  <Field label={`Question ${i + 1}`} hideLabel className={ap.grow} error={q.length > 200 ? "Keep it under 200 characters." : undefined}>
                    <Input maxLength={200} disabled={Boolean(locked)} value={q} placeholder="How do I…?" onChange={(e) => setStarter(i, e.target.value)} />
                  </Field>
                  <IconButton icon={<X aria-hidden />} label={`Remove question ${i + 1}`} disabled={Boolean(locked)} onClick={() => set({ starterQuestions: starters.filter((_, j) => j !== i) })} />
                </div>
              ))}
              {starters.length < 6 && !locked && (
                <Button variant="secondary" size="sm" className={ap.addStarter} onClick={() => set({ starterQuestions: [...starters, ""] })}>
                  <Plus aria-hidden /> Add a question
                </Button>
              )}
            </fieldset>
          </div>
        </Card>
      </div>
      <aside aria-label="Preview" className={ap.preview}>
        <p className={ap.previewLabel}>Preview</p>
        <div className={ap.previewFrame}>
          <ChatWelcome
            agent={{ name: p.name || "Agent", accentColor: errors.accentColor ? "" : p.accentColor, welcomeMessage: p.welcomeMessage, starterQuestions: starters, description: p.description }}
            disabled
          />
        </div>
      </aside>
    </div>
  );
}
