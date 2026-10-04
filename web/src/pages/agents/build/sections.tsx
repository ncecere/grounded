/*
 * Build's configuration (D2 / W2): Instructions, Model, Knowledge, Tools
 * (MCP server tools, docs/mcp-client.md), Answering, Safety, SystemOne checks (only with a SystemOne model) and
 * Advanced as accordion sections. A closed section shows a one-line summary,
 * or "Not saved: fix the highlighted field" while one of its fields holds
 * text that isn't valid (F-26).
 */
import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion/accordion";
import { Field } from "@/components/ui/field/field";
import { Textarea } from "@/components/ui/input/input";
import { useRerankStatus } from "@/lib/rerank";
import { useSystemOneStatus } from "@/lib/systemone";
import { useClassificationLevels, useKBs, useTeam } from "../../team/common";
import { asSentence, problemTarget, useChatModels } from "../common";
import type { AgentDraft } from "../draft";
import { AdvancedSection } from "./advanced-section";
import { AnsweringSection } from "./answering-section";
import cf from "./build.module.css";
import { KnowledgeSection, ModelSection } from "./model-section";
import { SafetySection } from "./safety-section";
import { type BuildSection, FieldValidity, type SectionProps, fieldPlace } from "./section";
import { sectionSummary } from "./summaries";
import { SystemOneChecks } from "./systemone-checks";
import { ToolsSection, useMCPToolOptions } from "./tools-section";

const maxInstructions = 20000;

const sentence = (text?: string) => (text ? asSentence(text) : undefined);

const titles: Record<BuildSection, string> = {
  instructions: "Instructions",
  model: "Model",
  knowledge: "Knowledge",
  tools: "Tools",
  answering: "Answering",
  safety: "Safety",
  systemone: "SystemOne checks",
  advanced: "Advanced",
};

type Props = {
  d: AgentDraft;
  /** The open sections (the editor keeps them, so a problem link can open one). */
  open: BuildSection[];
  onOpenChange: (open: BuildSection[]) => void;
};

export function BuildSections({ d, open, onOpenChange }: Props) {
  const { slug } = useTeam();
  const models = useChatModels();
  const levels = useClassificationLevels();
  const kbs = useKBs(slug);
  const systemOne = useSystemOneStatus();
  const rerank = useRerankStatus();
  const tools = useMCPToolOptions();
  const c = d.draft.config;
  const section: SectionProps = {
    c,
    set: d.setConfig,
    errorFor: (field) => sentence(d.problems.find((p) => problemTarget(p.field).id === problemTarget(field).id)?.problem),
    warningFor: (field) => sentence(d.base.warnings.find((w) => w.field === `draft.${field}`)?.problem),
    model: models.data?.find((m) => m.id === c.chatModelId),
    levelName: (key) => levels.data?.find((l) => l.key === key)?.name ?? key,
  };
  const s1 = systemOne.data?.available ? systemOne.data : undefined;
  const summaryInput = {
    c,
    model: section.model,
    kbName: (id: string) => kbs.data?.find((k) => k.id === id)?.name,
    systemOne: s1 && { judging: s1.judging.enabled, citations: s1.citations.enabled, citationMode: s1.citations.mode, scope: s1.scope.enabled },
    rerank: rerank.data?.available ? { defaultTopN: rerank.data.defaultTopN } : undefined,
    toolName: (id: string) => tools.data?.find((t) => t.id === id)?.name,
  };
  const invalidIn = new Set(d.invalidFields.map((f) => fieldPlace(f).section));
  const problemIn = new Set([...d.problems, ...d.base.warnings.filter((w) => w.field.startsWith("draft."))].map((p) => fieldPlace(p.field).section));

  const content: Record<BuildSection, ReactNode> = {
    instructions: <InstructionsSection {...section} />,
    model: <ModelSection {...section} />,
    knowledge: <KnowledgeSection {...section} />,
    tools: <ToolsSection {...section} />,
    answering: <AnsweringSection {...section} />,
    safety: <SafetySection {...section} />,
    systemone: <SystemOneChecks c={c} set={d.setConfig} errorFor={section.errorFor} />,
    advanced: <AdvancedSection {...section} />,
  };
  const shown = (Object.keys(titles) as BuildSection[]).filter((k) => k !== "systemone" || s1);

  return (
    <FieldValidity.Provider value={d.reportInvalid}>
      <Accordion multiple variant="plain" headingLevel={2} value={open} onValueChange={(v) => onOpenChange(v as BuildSection[])} className={cf.sections}>
        {shown.map((key) => {
          const needsFix = invalidIn.has(key) || problemIn.has(key);
          return (
            <AccordionItem key={key} value={key}>
              <AccordionTrigger
                meta={
                  needsFix ? (
                    <span className={cf.fixMeta}>
                      <CircleAlert aria-hidden /> {invalidIn.has(key) ? "Not saved: fix the highlighted field" : "Needs fixing"}
                    </span>
                  ) : open.includes(key) ? undefined : (
                    <span className={cf.summary} title={sectionSummary(key, summaryInput)}>
                      {sectionSummary(key, summaryInput)}
                    </span>
                  )
                }
              >
                <span className={cf.sectionTitle}>{titles[key]}</span>
              </AccordionTrigger>
              <AccordionPanel keepMounted>{content[key]}</AccordionPanel>
            </AccordionItem>
          );
        })}
      </Accordion>
    </FieldValidity.Provider>
  );
}

function InstructionsSection({ c, set, errorFor }: SectionProps) {
  const tooLong = c.instructions.length > maxInstructions;
  return (
    <Field
      label="Instructions"
      hideLabel
      description={`What the agent does and how it answers; the platform adds rules for sources, citations and grounding. ${c.instructions.length.toLocaleString()} / ${maxInstructions.toLocaleString()} characters.`}
      error={tooLong ? "The instructions are too long." : errorFor("instructions")}
    >
      <Textarea
        id="agent-field-instructions"
        rows={10}
        className={cf.instructions}
        value={c.instructions}
        // A short hint that can't be mistaken for written instructions (VI-04).
        placeholder="For example: Answer questions about registration. Keep answers short."
        onChange={(e) => set({ instructions: e.target.value })}
      />
    </Field>
  );
}
