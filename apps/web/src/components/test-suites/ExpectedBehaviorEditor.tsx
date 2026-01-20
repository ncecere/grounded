import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import type {
  ContainsPhrasesCheck,
  ExpectedBehavior,
  ExpectedCheck,
  LlmJudgeCheck,
  SemanticSimilarityCheck,
} from "../../lib/api";

export const DEFAULT_SEMANTIC_SIMILARITY_THRESHOLD = 0.8;

export const DEFAULT_EXPECTED_BEHAVIOR: ExpectedBehavior = {
  mode: "all",
  checks: [],
};

const createCheck = (type: ExpectedCheck["type"]): ExpectedCheck => {
  switch (type) {
    case "contains_phrases":
      return { type, phrases: [], caseSensitive: false };
    case "semantic_similarity":
      return { type, expectedAnswer: "", threshold: DEFAULT_SEMANTIC_SIMILARITY_THRESHOLD };
    case "llm_judge":
      return { type, expectedAnswer: "", criteria: "" };
    default:
      return { type: "contains_phrases", phrases: [], caseSensitive: false };
  }
};

interface ExpectedBehaviorEditorProps {
  value: ExpectedBehavior;
  onChange: (value: ExpectedBehavior) => void;
  disabled?: boolean;
}

export function ExpectedBehaviorEditor({ value, onChange, disabled = false }: ExpectedBehaviorEditorProps) {
  const [phraseDrafts, setPhraseDrafts] = useState<Record<string, string>>({});

  const updateChecks = (checks: ExpectedCheck[]) => onChange({ ...value, checks });

  const updateCheck = (index: number, nextCheck: ExpectedCheck) => {
    updateChecks(value.checks.map((check, idx) => (idx === index ? nextCheck : check)));
  };

  const addCheck = (type: ExpectedCheck["type"]) => {
    updateChecks([...value.checks, createCheck(type)]);
  };

  const removeCheck = (index: number) => {
    updateChecks(value.checks.filter((_, idx) => idx !== index));
  };

  const addPhrase = (index: number) => {
    const draftKey = `phrases-${index}`;
    const phrase = (phraseDrafts[draftKey] ?? "").trim();
    if (!phrase) return;

    const check = value.checks[index] as ContainsPhrasesCheck;
    if (check.phrases.includes(phrase)) {
      setPhraseDrafts((prev) => ({ ...prev, [draftKey]: "" }));
      return;
    }

    updateCheck(index, { ...check, phrases: [...check.phrases, phrase] });
    setPhraseDrafts((prev) => ({ ...prev, [draftKey]: "" }));
  };

  const removePhrase = (index: number, phrase: string) => {
    const check = value.checks[index] as ContainsPhrasesCheck;
    updateCheck(index, { ...check, phrases: check.phrases.filter((item) => item !== phrase) });
  };

  const renderContainsCheck = (check: ContainsPhrasesCheck, index: number) => {
    const draftKey = `phrases-${index}`;
    const hasPhrases = check.phrases.length > 0;

    return (
      <div key={`contains-${index}`} className="border border-border rounded-lg p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Contains phrases</p>
            <p className="text-xs text-muted-foreground">Require the response to include specific phrases.</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => removeCheck(index)}
            disabled={disabled}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground">Phrases</Label>
          <div className="flex gap-2">
            <Input
              value={phraseDrafts[draftKey] ?? ""}
              onChange={(event) =>
                setPhraseDrafts((prev) => ({ ...prev, [draftKey]: event.target.value }))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addPhrase(index);
                }
              }}
              placeholder="Add a required phrase"
              disabled={disabled}
            />
            <Button type="button" variant="outline" onClick={() => addPhrase(index)} disabled={disabled}>
              Add
            </Button>
          </div>
          {hasPhrases ? (
            <div className="flex flex-wrap gap-2">
              {check.phrases.map((phrase) => (
                <Badge key={phrase} variant="secondary" className="flex items-center gap-1">
                  <span>{phrase}</span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => removePhrase(index, phrase)}
                    disabled={disabled}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No phrases added yet.</p>
          )}
        </div>

        <div className="flex items-center justify-between border border-border rounded-lg p-3">
          <div>
            <Label className="text-sm">Case sensitive</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Match uppercase/lowercase exactly.
            </p>
          </div>
          <Switch
            checked={check.caseSensitive ?? false}
            onCheckedChange={(checked) => updateCheck(index, { ...check, caseSensitive: checked })}
            disabled={disabled}
          />
        </div>
      </div>
    );
  };

  const renderSemanticCheck = (check: SemanticSimilarityCheck, index: number) => (
    <div key={`semantic-${index}`} className="border border-border rounded-lg p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Semantic similarity</p>
          <p className="text-xs text-muted-foreground">
            Score the response against an expected answer.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={() => removeCheck(index)}
          disabled={disabled}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2">
        <Label>Expected Answer</Label>
        <Textarea
          value={check.expectedAnswer}
          onChange={(event) => updateCheck(index, { ...check, expectedAnswer: event.target.value })}
          rows={3}
          placeholder="What should the agent say?"
          disabled={disabled}
        />
      </div>

      <div className="space-y-2">
        <Label>Similarity Threshold</Label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={check.threshold}
            onChange={(event) =>
              updateCheck(index, { ...check, threshold: parseFloat(event.target.value) })
            }
            className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
            disabled={disabled}
          />
          <span className="text-sm font-medium w-12 text-right">{check.threshold.toFixed(2)}</span>
        </div>
        <p className="text-xs text-muted-foreground">Higher values require closer matches.</p>
      </div>
    </div>
  );

  const renderLlmJudgeCheck = (check: LlmJudgeCheck, index: number) => (
    <div key={`judge-${index}`} className="border border-border rounded-lg p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">LLM judge</p>
          <p className="text-xs text-muted-foreground">
            Use an LLM to score qualitative criteria.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={() => removeCheck(index)}
          disabled={disabled}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2">
        <Label>Expected Answer</Label>
        <Textarea
          value={check.expectedAnswer}
          onChange={(event) => updateCheck(index, { ...check, expectedAnswer: event.target.value })}
          rows={3}
          placeholder="Describe the ideal response"
          disabled={disabled}
        />
      </div>

      <div className="space-y-2">
        <Label>Evaluation Criteria</Label>
        <Textarea
          value={check.criteria ?? ""}
          onChange={(event) => updateCheck(index, { ...check, criteria: event.target.value })}
          rows={2}
          placeholder="What should the judge look for?"
          disabled={disabled}
        />
      </div>
    </div>
  );

  const containsChecks = value.checks.some((check) => check.type === "contains_phrases");
  const semanticChecks = value.checks.some((check) => check.type === "semantic_similarity");
  const judgeChecks = value.checks.some((check) => check.type === "llm_judge");

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>Evaluation Mode</Label>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={value.mode === "all" ? "default" : "outline"}
            onClick={() => onChange({ ...value, mode: "all" })}
            disabled={disabled}
          >
            All checks must pass
          </Button>
          <Button
            type="button"
            variant={value.mode === "any" ? "default" : "outline"}
            onClick={() => onChange({ ...value, mode: "any" })}
            disabled={disabled}
          >
            Any check can pass
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Choose whether every check must pass or if a single passing check is enough.
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Contains phrases checks</p>
            <p className="text-xs text-muted-foreground">Require specific phrases to appear.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => addCheck("contains_phrases")}
            disabled={disabled}
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
        {containsChecks ? (
          value.checks.map((check, index) =>
            check.type === "contains_phrases"
              ? renderContainsCheck(check, index)
              : null
          )
        ) : (
          <p className="text-xs text-muted-foreground">No phrase checks yet.</p>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Semantic similarity checks</p>
            <p className="text-xs text-muted-foreground">Compare answers to an expected response.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => addCheck("semantic_similarity")}
            disabled={disabled}
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
        {semanticChecks ? (
          value.checks.map((check, index) =>
            check.type === "semantic_similarity" ? renderSemanticCheck(check, index) : null
          )
        ) : (
          <p className="text-xs text-muted-foreground">No similarity checks yet.</p>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">LLM judge checks</p>
            <p className="text-xs text-muted-foreground">Qualitative scoring with a model.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => addCheck("llm_judge")}
            disabled={disabled}
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
        {judgeChecks ? (
          value.checks.map((check, index) =>
            check.type === "llm_judge" ? renderLlmJudgeCheck(check, index) : null
          )
        ) : (
          <p className="text-xs text-muted-foreground">No LLM judge checks yet.</p>
        )}
      </div>
    </div>
  );
}
