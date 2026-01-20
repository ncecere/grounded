import { type DragEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, FileText, UploadCloud } from "lucide-react";
import { useImportTestCases } from "../../lib/api/test-suites.hooks";
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

type ImportResult = {
  imported: number;
  skipped: number;
  errors: Array<{ line: number; message: string }>;
};

const JSONL_EXAMPLE = `{"name":"Greeting check","question":"Say hello","expectedBehavior":{"mode":"all","checks":[{"type":"contains_phrases","phrases":["hello"],"caseSensitive":false}]}}\n{"name":"Summary check","question":"Summarize pricing","expectedBehavior":{"mode":"any","checks":[{"type":"semantic_similarity","expectedAnswer":"Plans start at $49","threshold":0.8},{"type":"llm_judge","expectedAnswer":"Mentions billing cadence","criteria":"Should mention monthly pricing"}]}}`;

interface ImportTestCasesDialogProps {
  suiteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportTestCasesDialog({ suiteId, open, onOpenChange }: ImportTestCasesDialogProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const importMutation = useImportTestCases(suiteId);

  useEffect(() => {
    if (!open) {
      setSelectedFile(null);
      setIsDragging(false);
      setResult(null);
      setLocalError(null);
    }
  }, [open]);

  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSelectedFile(files[0]);
    setResult(null);
    setLocalError(null);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    handleFileSelect(event.dataTransfer.files);
  };

  const handleImport = () => {
    if (!selectedFile) {
      setLocalError("Select a JSONL file to import.");
      return;
    }

    setLocalError(null);
    importMutation.mutate(selectedFile, {
      onSuccess: (data) => {
        setResult(data as ImportResult);
      },
      onError: (error) => {
        setLocalError(error instanceof Error ? error.message : "Import failed.");
      },
    });
  };

  const errors = result?.errors ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Test Cases</DialogTitle>
          <DialogDescription>
            Upload a JSONL file to create multiple test cases at once.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 space-y-5">
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
              isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".jsonl,application/json"
              className="hidden"
              onChange={(event) => handleFileSelect(event.target.files)}
            />
            <UploadCloud className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              <span className="font-medium text-primary">Click to upload</span> or drag and drop a
              JSONL file
            </p>
            <p className="mt-1 text-xs text-muted-foreground">One test case per line.</p>
          </div>

          {selectedFile && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <div className="text-sm text-foreground truncate">{selectedFile.name}</div>
                <div className="text-xs text-muted-foreground">({(selectedFile.size / 1024).toFixed(1)} KB)</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedFile(null)}
                disabled={importMutation.isPending}
              >
                Remove
              </Button>
            </div>
          )}

          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
            <div>
              <p className="text-sm font-medium">Format instructions</p>
              <p className="text-xs text-muted-foreground">
                Each line must be valid JSON with required fields: name, question, expectedBehavior.
              </p>
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">expectedBehavior</span> must include a
              mode (all/any) and at least one check.
            </div>
            <pre className="text-xs bg-background border border-border rounded-md p-3 overflow-x-auto">
{JSONL_EXAMPLE}
            </pre>
          </div>

          {result && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Imported: {result.imported}</Badge>
                <Badge variant="outline">Skipped: {result.skipped}</Badge>
                <Badge variant={errors.length > 0 ? "destructive" : "secondary"}>
                  Errors: {errors.length}
                </Badge>
              </div>
              {errors.length > 0 && (
                <ScrollArea className="max-h-40">
                  <div className="space-y-2 pr-2">
                    {errors.map((error) => (
                      <div key={`${error.line}-${error.message}`} className="text-xs text-destructive">
                        Line {error.line}: {error.message}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
              {errors.length === 0 && result.imported > 0 && (
                <p className="text-xs text-muted-foreground">
                  All test cases were imported successfully.
                </p>
              )}
            </div>
          )}

          {(localError || importMutation.error) && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
              <p className="text-xs text-destructive">
                {localError ?? importMutation.error?.message}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handleImport} disabled={importMutation.isPending || !selectedFile}>
            {importMutation.isPending ? "Importing..." : "Import Test Cases"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
