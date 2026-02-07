export const SUPPORTED_FORMATS = [
  { ext: ".pdf", desc: "PDF Documents" },
  { ext: ".docx", desc: "Word Documents" },
  { ext: ".xlsx", desc: "Excel Spreadsheets" },
  { ext: ".pptx", desc: "PowerPoint Presentations" },
  { ext: ".csv", desc: "CSV Files" },
  { ext: ".txt", desc: "Text Files" },
  { ext: ".md", desc: "Markdown Files" },
  { ext: ".html", desc: "HTML Files" },
  { ext: ".json", desc: "JSON Files" },
  { ext: ".xml", desc: "XML Files" },
];

export const ACCEPTED_FILE_TYPES = ".pdf,.docx,.xlsx,.pptx,.csv,.txt,.md,.markdown,.html,.htm,.json,.xml";

export function getDisplayStatus(run: { status: string; stage?: string | null; chunksToEmbed: number; chunksEmbedded: number }) {
  if (run.status === "running" && run.stage) {
    return run.stage;
  }
  if (run.status === "succeeded" && run.chunksToEmbed > 0 && run.chunksEmbedded < run.chunksToEmbed) {
    return "embedding";
  }
  return run.status;
}

export function getStageLabel(stage: string) {
  switch (stage) {
    case "processing":
      return "Processing pages...";
    case "indexing":
      return "Indexing content...";
    case "embedding":
      return "Embedding chunks...";
    case "completed":
      return "Completed";
    default:
      return stage;
  }
}

export function getStatusColor(status: string) {
  switch (status) {
    case "active":
    case "succeeded":
    case "completed":
      return "bg-green-500/15 text-green-700 dark:text-green-400";
    case "paused":
    case "pending":
      return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
    case "error":
    case "failed":
    case "canceled":
      return "bg-red-500/15 text-red-700 dark:text-red-400";
    case "running":
    case "partial":
    case "processing":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400";
    case "indexing":
      return "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400";
    case "embedding":
      return "bg-purple-500/15 text-purple-700 dark:text-purple-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}
