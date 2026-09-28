/* The Appearance tab: name, address, description, accent colour, welcome message, starter questions and a live preview. */
import { Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge/badge";
import { Button, IconButton } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { ColorField } from "@/components/ui/color-field/color-field";
import { Field } from "@/components/ui/field/field";
import { Input, Textarea } from "@/components/ui/input/input";
import { ChatWelcome } from "../chat/welcome";
import { useTeam } from "../team/common";
import { ACCENT_PRESETS, ACCENT_TEXT, themeAccent } from "./accents.colors";
import { type AgentDraft, profileErrors } from "./draft";
import a from "./agents.module.css";
import ap from "./appearance.module.css";

export function AppearanceTab({ d }: { d: AgentDraft }) {
  const { slug: team } = useTeam();
  const p = d.draft.profile;
  const set = d.setProfile;
  const errors = profileErrors(p);
  const starters = p.starterQuestions;
  const setStarter = (i: number, v: string) => set({ starterQuestions: starters.map((q, j) => (j === i ? v : q)) });
  // No accent: the theme's primary, as in the preview and the chat (G17).
  const defaultAccent = themeAccent();

  return (
    <div className={ap.appearance}>
      <div className={a.stack}>
        <p className={ap.liveNote}>
          <Badge tone="info">Live</Badge> Changes here reach people as soon as they're saved. They aren't part of versions.
        </p>
        <Card title="Profile">
          <div className={a.stack}>
            <Field label="Name" error={errors.name}>
              <Input id="agent-field-name" maxLength={80} value={p.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Address" description={`Chat link: /a/${team}/${p.slug || "…"}. Changing it breaks links people saved.`} error={errors.slug}>
              <Input id="agent-field-slug" maxLength={63} spellCheck={false} value={p.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase() })} />
            </Field>
            <Field label="Description" labelHint="Optional" description="Shown in Discover agents.">
              <Textarea rows={2} maxLength={500} value={p.description} onChange={(e) => set({ description: e.target.value })} />
            </Field>
          </div>
        </Card>
        <Card title="Look and welcome">
          <div className={a.stack}>
            <Field
              label="Accent colour"
              description={`Used for the agent's avatar and highlights, always with white text. Leave it empty for the theme's colour, ${defaultAccent}.`}
              error={errors.accentColor}
            >
              <ColorField
                value={p.accentColor}
                onValueChange={(accentColor) => set({ accentColor })}
                defaultColor={defaultAccent}
                contrastWith={ACCENT_TEXT}
                contrastLabel="white text"
                presets={ACCENT_PRESETS}
              />
            </Field>
            <Field label="Welcome message" labelHint="Optional" description={`${p.welcomeMessage.length} / 1,000 characters. Shown before the first question.`}>
              <Textarea rows={3} maxLength={1000} value={p.welcomeMessage} onChange={(e) => set({ welcomeMessage: e.target.value })} />
            </Field>
            <fieldset className={ap.starters}>
              <legend className={ap.legend}>Starter questions</legend>
              <p className={ap.legendHint}>Up to 6 suggestions people can click to start. Empty ones are ignored.</p>
              {starters.map((q, i) => (
                <div key={i} className={ap.starterRow}>
                  <Field label={`Question ${i + 1}`} hideLabel className={ap.grow} error={q.length > 200 ? "Keep it under 200 characters." : undefined}>
                    <Input maxLength={200} value={q} placeholder="How do I…?" onChange={(e) => setStarter(i, e.target.value)} />
                  </Field>
                  <IconButton icon={<X aria-hidden />} label={`Remove question ${i + 1}`} onClick={() => set({ starterQuestions: starters.filter((_, j) => j !== i) })} />
                </div>
              ))}
              {starters.length < 6 && (
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
