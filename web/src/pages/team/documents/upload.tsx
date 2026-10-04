/*
 * Uploading files to a source: the XHR upload, the drop zone and the per-file
 * results, in the "Upload files" dialog of the source page (W3). Tags typed
 * but not yet committed with Enter are applied too (F-06), and a paused
 * source offers no drop zone, only the reason (F-21).
 */
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, type Schemas } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { useCurrentUser } from "@/session";
import { Alert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { DropZone } from "@/components/ui/drop-zone/drop-zone";
import { Field } from "@/components/ui/field/field";
import { Progress } from "@/components/ui/progress/progress";
import { GuardedDialog } from "@/components/templates/close-guard";
import { DialogClose } from "@/components/ui/dialog/dialog";
import { TagInput } from "@/components/ui/tag-input/tag-input";
import { toast } from "@/components/ui/toast/toast";
import type { Tone } from "@/lib/bitop-utils";
import { type DataSource, useSourceOwner } from "../../sources/owner";
import { plural } from "../common";
import { type OcrState, imageExtensions, imagesRefused, isImage, ocrFix, ocrStateOf } from "./ocr-state";
import d from "./upload.module.css";

type UploadResult = Schemas["UploadResult"];

const acceptedExtensions = [".pdf", ".docx", ".pptx", ".html", ".htm", ".md", ".markdown", ".txt"];
const documentTypes = "PDF, Word (.docx), PowerPoint (.pptx), HTML, Markdown and plain text";

/** The server accepts at most this many files per request. */
const batchSize = 100;

/**
 * Uploads files with XMLHttpRequest (fetch can't report upload progress).
 * Cookies are sent automatically because the request is same-origin; the
 * CSRF token goes in a header like every other unsafe request.
 */
export function uploadFiles({
  path,
  files,
  csrfToken,
  onProgress,
  tags = [],
}: {
  /** The documents collection, e.g. /v1/teams/{team}/sources/{sourceId}/documents. */
  path: string;
  files: File[];
  csrfToken: string;
  onProgress: (loaded: number) => void;
  /** Tags for every file. Sent before the files, so invalid tags are refused before anything is stored. */
  tags?: string[];
}): Promise<UploadResult[]> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const t of tags) form.append("tags", t);
    for (const f of files) form.append("files", f, f.name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.setRequestHeader("Accept", "application/json");
    if (csrfToken) xhr.setRequestHeader("X-CSRF-Token", csrfToken);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      let body: { data?: UploadResult[]; error?: { code?: string; message?: string; details?: Record<string, unknown> } } | undefined;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300 && Array.isArray(body?.data)) {
        resolve(body.data);
      } else {
        reject(
          new ApiError(
            xhr.status,
            body?.error?.code ?? `http_${xhr.status}`,
            body?.error?.message ?? (xhr.status === 413 ? "The upload is too large." : `Upload failed (${xhr.status})`),
            body?.error?.details,
          ),
        );
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "network_error", "The upload failed. Check your connection and try again."));
    xhr.send(form);
  });
}

const resultLabels: Record<UploadResult["status"], { label: string; tone: Tone }> = {
  created: { label: "Added", tone: "success" },
  replaced: { label: "Replaced with a new version", tone: "info" },
  unchanged: { label: "Unchanged", tone: "neutral" },
  rejected: { label: "Rejected", tone: "danger" },
};

function summarizeUpload(results: UploadResult[]) {
  const n = (s: UploadResult["status"]) => results.filter((r) => r.status === s).length;
  const parts = [
    n("created") && `${n("created")} added`,
    n("replaced") && `${n("replaced")} replaced`,
    n("unchanged") && `${n("unchanged")} unchanged`,
    n("rejected") && `${n("rejected")} rejected`,
  ].filter(Boolean);
  return `Upload finished for ${plural(results.length, "file")}: ${parts.join(", ")}.`;
}

type UploadProgress = { files: number; loaded: number; total: number };

/** Tags typed into the TagInput but not committed yet (no Enter, comma or blur), normalised like TagInput does. */
export function withPendingTags(tags: string[], pending: string | undefined): string[] {
  const out = [...tags];
  for (const part of (pending ?? "").split(",")) {
    const t = part.trim().toLowerCase().slice(0, 64);
    if (t && !out.includes(t) && out.length < 20) out.push(t);
  }
  return out;
}

type UploadAreaProps = {
  sourceId: string;
  /** Why uploads are unavailable (a paused source): shown instead of the drop zone. */
  disabledReason?: string;
  /** Called after a batch finishes with the number of files stored. */
  onUploaded?: (stored: number) => void;
  /** Whether OCR reads the source's images: images are accepted only when it is "on" (the server checks again). */
  ocr?: OcrState;
  /** Opens the source's Settings tab, offered when the source's own OCR switch is what refuses images. */
  onOpenSettings?: () => void;
  /** Something would be lost by closing: an upload is running. Tags alone apply only to the next upload, so they don't count (BU-12). */
  onPendingChange?: (pending: boolean) => void;
};

export function UploadArea({ sourceId, disabledReason, onUploaded, onPendingChange, ocr = "source_off", onOpenSettings }: UploadAreaProps) {
  const owner = useSourceOwner();
  const { csrfToken } = useCurrentUser();
  const qc = useQueryClient();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [results, setResults] = useState<UploadResult[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tags, setTags] = useState<string[]>([]);
  // Images refused because OCR doesn't read them here: said once, with the reason (not "isn't an accepted file type" alone).
  const [refusedImages, setRefusedImages] = useState<string[]>([]);
  const tagInput = useRef<HTMLInputElement>(null);

  async function start(list: File[]) {
    if (list.length === 0 || progress) return;
    // F-06: a drop doesn't blur the tag input, so commit its pending text here.
    const uploadTags = withPendingTags(tags, tagInput.current?.value);
    if (tagInput.current?.value.trim()) {
      setTags(uploadTags);
      tagInput.current.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    }
    setResults(null);
    setError(null);
    setRefusedImages([]);
    const total = list.reduce((sum, f) => sum + f.size, 0);
    setProgress({ files: list.length, loaded: 0, total });
    const all: UploadResult[] = [];
    let done = 0;
    try {
      for (let i = 0; i < list.length; i += batchSize) {
        const batch = list.slice(i, i + batchSize);
        all.push(
          ...(await uploadFiles({
            path: owner.api.uploadPath(sourceId),
            files: batch,
            csrfToken,
            tags: uploadTags,
            onProgress: (loaded) => setProgress({ files: list.length, loaded: done + Math.min(loaded, total - done), total }),
          })),
        );
        done += batch.reduce((sum, f) => sum + f.size, 0);
      }
    } catch (err) {
      setError(err);
    } finally {
      setProgress(null);
      if (all.length > 0) {
        setResults(all);
        const rejected = all.filter((r) => r.status === "rejected").length;
        if (rejected === 0) toast.success("Upload finished", `${plural(all.length, "file")} uploaded.`);
        onUploaded?.(all.length - rejected);
      }
      qc.invalidateQueries({ queryKey: owner.keys.source(sourceId) });
      qc.invalidateQueries({ queryKey: owner.keys.list });
    }
  }

  const pending = progress !== null;
  useEffect(() => onPendingChange?.(pending), [pending, onPendingChange]);

  const percent = progress && progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0;
  const limited = results?.find((r) => r.error?.code === "limit_reached");
  if (disabledReason) return <Alert tone="warning" title="Uploads are paused">{disabledReason}</Alert>;

  return (
    <div className={d.upload}>
      <Field
        label="Tags for these files"
        labelHint="Optional"
        description="Added to every file you upload next, so agents and searches can filter on them. A replaced file keeps its tags unless you set some here."
      >
        <TagInput ref={tagInput} value={tags} onValueChange={setTags} maxTags={20} disabled={progress !== null} />
      </Field>
      <DropZone
        onFiles={(files) => void start(files)}
        onReject={(rejected) => setRefusedImages(ocr === "on" ? [] : rejected.filter((r) => r.reason === "type" && isImage(r.file.name)).map((r) => r.file.name))}
        busy={progress !== null}
        label="Drag and drop files here, or"
        buttonLabel="Choose files to upload"
        accept={[...acceptedExtensions, ...(ocr === "on" ? imageExtensions : [])].join(",")}
        description={ocr === "on" ? `${documentTypes}, and PNG, JPEG or TIFF images (read with OCR).` : `${documentTypes}. ${imagesRefused[ocr]}`}
      />
      {ocr !== "on" && refusedImages.length > 0 && (
        <Alert tone="warning" title={refusedImages.length === 1 ? `${refusedImages[0]} wasn't uploaded` : `${plural(refusedImages.length, "image")} weren't uploaded`}>
          {imagesRefused[ocr]} {ocrFix[ocr]}
          {ocr === "source_off" && onOpenSettings && (
            <span className={d.alertAction}>
              <Button size="sm" variant="secondary" onClick={onOpenSettings}>
                <Settings2 aria-hidden /> Open settings
              </Button>
            </span>
          )}
        </Alert>
      )}
      {progress && <Progress label={`Uploading ${plural(progress.files, "file")}`} value={percent} />}
      <p role="status" className={d.uploadStatus}>
        {progress && `Uploading ${plural(progress.files, "file")}… ${Math.floor(percent / 10) * 10}%`}
        {results && summarizeUpload(results)}
      </p>
      <ApiErrorAlert error={error} />
      {limited && (
        <Alert tone="warning" title="Team limit reached">
          {limited.error?.message} Files marked Rejected below weren't added.
        </Alert>
      )}
      {results && <UploadResults results={results} />}
    </div>
  );
}

type UploadDialogProps = { source: DataSource; open: boolean; onClose: () => void; onUploaded?: () => void; onOpenSettings?: () => void };

/** The header's "Upload files" dialog: tags first, then the drop zone and the results. */
export function UploadDialog({ source, open, onClose, onUploaded, onOpenSettings }: UploadDialogProps) {
  const paused = source.status === "paused";
  const [pending, setPending] = useState(false);
  return (
    <GuardedDialog
      open={open}
      dirty={pending}
      onClose={onClose}
      size="lg"
      title="Upload files"
      description={`Add files to ${source.name}. A file with the same name as an existing document replaces it with a new version.`}
      footer={<DialogClose>Done</DialogClose>}
    >
      <UploadArea
        sourceId={source.id}
        ocr={ocrStateOf(source)}
        onOpenSettings={onOpenSettings}
        disabledReason={paused ? "This source is paused. Resume it to upload files." : undefined}
        onUploaded={(n) => n > 0 && onUploaded?.()}
        onPendingChange={setPending}
      />
    </GuardedDialog>
  );
}

function UploadResults({ results }: { results: UploadResult[] }) {
  return (
    <ul aria-label="Upload results" className={d.results}>
      {results.map((r, i) => {
        const l = resultLabels[r.status];
        return (
          <li key={i} className={d.result}>
            <FileText aria-hidden className={d.resultIcon} />
            <span className={d.resultName}>{r.filename}</span>
            <Badge tone={l.tone}>{l.label}</Badge>
            {r.error && <span className={d.resultError}>{r.error.message}</span>}
          </li>
        );
      })}
    </ul>
  );
}
