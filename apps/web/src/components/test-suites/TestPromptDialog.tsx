import { useState } from "react";
import { ChevronDown, ChevronUp, FlaskConical, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Label } from "../ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { ScrollArea } from "../ui/scroll-area";

interface TestPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentAgentPrompt: string;
  onStartTest: (candidatePrompt: string) => void;
  isLoading?: boolean;
}

export function TestPromptDialog({
  open,
  onOpenChange,
  currentAgentPrompt,
  onStartTest,
  isLoading,
}: TestPromptDialogProps) {
  const [candidatePrompt, setCandidatePrompt] = useState("");
  const [showCurrentPrompt, setShowCurrentPrompt] = useState(false);

  const handleStartTest = () => {
    if (!candidatePrompt.trim()) return;
    onStartTest(candidatePrompt.trim());
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset state when closing
      setCandidatePrompt("");
      setShowCurrentPrompt(false);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            Test Custom Prompt
          </DialogTitle>
          <DialogDescription>
            Enter a candidate prompt to A/B test against the current agent prompt. The test will
            run both prompts and compare results.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-hidden">
          {/* Current prompt (collapsible reference) */}
          <Collapsible open={showCurrentPrompt} onOpenChange={setShowCurrentPrompt}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-between px-3 py-2 h-auto text-left"
              >
                <span className="text-sm text-muted-foreground">
                  View current agent prompt for reference
                </span>
                {showCurrentPrompt ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ScrollArea className="h-32 mt-2 rounded-md border bg-muted/30">
                <pre className="p-3 text-xs font-mono whitespace-pre-wrap text-muted-foreground">
                  {currentAgentPrompt || "(No system prompt configured)"}
                </pre>
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>

          {/* Candidate prompt input */}
          <div className="space-y-2">
            <Label htmlFor="candidate-prompt">Candidate Prompt</Label>
            <Textarea
              id="candidate-prompt"
              placeholder="Enter the new prompt you want to test..."
              value={candidatePrompt}
              onChange={(e) => setCandidatePrompt(e.target.value)}
              className="min-h-[200px] font-mono text-sm resize-none"
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">
              This prompt will be tested against all test cases in the suite and compared with the
              baseline (current agent prompt).
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleStartTest}
            disabled={isLoading || !candidatePrompt.trim()}
            className="gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <FlaskConical className="h-4 w-4" />
                Start A/B Test
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
