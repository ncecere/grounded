import { useMemo, useState } from "react";
import { diffLines, Change } from "diff";
import { AlertTriangle, Check, Minus, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { cn } from "@/lib/utils";

interface ApplyPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPrompt: string;
  suggestedPrompt: string;
  onConfirm: () => void;
  isLoading?: boolean;
}

export function ApplyPromptDialog({
  open,
  onOpenChange,
  currentPrompt,
  suggestedPrompt,
  onConfirm,
  isLoading,
}: ApplyPromptDialogProps) {
  const [viewMode, setViewMode] = useState<"diff" | "side-by-side" | "new">("diff");

  const diff = useMemo(() => {
    return diffLines(currentPrompt, suggestedPrompt);
  }, [currentPrompt, suggestedPrompt]);

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    diff.forEach((part) => {
      if (part.added) added += part.count ?? 0;
      if (part.removed) removed += part.count ?? 0;
    });
    return { added, removed };
  }, [diff]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Apply Suggested Prompt
          </DialogTitle>
          <DialogDescription>
            This will update the agent&apos;s system prompt. Review the changes below before
            applying.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="outline" className="gap-1 text-green-600">
              <Plus className="h-3 w-3" />
              {stats.added} added
            </Badge>
            <Badge variant="outline" className="gap-1 text-red-600">
              <Minus className="h-3 w-3" />
              {stats.removed} removed
            </Badge>
          </div>

          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as typeof viewMode)}>
            <TabsList className="h-8">
              <TabsTrigger value="diff" className="text-xs px-2 h-6">
                Diff
              </TabsTrigger>
              <TabsTrigger value="side-by-side" className="text-xs px-2 h-6">
                Side by Side
              </TabsTrigger>
              <TabsTrigger value="new" className="text-xs px-2 h-6">
                New Prompt
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <ScrollArea className="flex-1 border rounded-lg bg-muted/30">
          <div className="p-4">
            {viewMode === "diff" && <DiffView diff={diff} />}
            {viewMode === "side-by-side" && (
              <SideBySideView current={currentPrompt} suggested={suggestedPrompt} />
            )}
            {viewMode === "new" && <NewPromptView prompt={suggestedPrompt} />}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isLoading} className="gap-2">
            {isLoading ? (
              "Applying..."
            ) : (
              <>
                <Check className="h-4 w-4" />
                Apply Prompt
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiffView({ diff }: { diff: Change[] }) {
  return (
    <pre className="text-xs font-mono whitespace-pre-wrap">
      {diff.map((part, index) => (
        <span
          key={index}
          className={cn(
            part.added && "bg-green-500/20 text-green-700 dark:text-green-300",
            part.removed && "bg-red-500/20 text-red-700 dark:text-red-300 line-through"
          )}
        >
          {part.value}
        </span>
      ))}
    </pre>
  );
}

function SideBySideView({ current, suggested }: { current: string; suggested: string }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Current Prompt</p>
        <pre className="text-xs font-mono whitespace-pre-wrap bg-red-500/10 p-3 rounded border border-red-500/20">
          {current}
        </pre>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Suggested Prompt</p>
        <pre className="text-xs font-mono whitespace-pre-wrap bg-green-500/10 p-3 rounded border border-green-500/20">
          {suggested}
        </pre>
      </div>
    </div>
  );
}

function NewPromptView({ prompt }: { prompt: string }) {
  return (
    <pre className="text-xs font-mono whitespace-pre-wrap">{prompt}</pre>
  );
}
