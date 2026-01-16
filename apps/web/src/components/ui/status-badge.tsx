import { cn } from "@/lib/utils"

type StatusType = "active" | "inactive" | "pending" | "error" | "success" | "warning" | "default"

interface StatusBadgeProps {
  status: StatusType
  label?: string
  showDot?: boolean
  className?: string
}

const statusConfig: Record<StatusType, { bg: string; text: string; dot: string; defaultLabel: string }> = {
  active: {
    bg: "bg-success/15",
    text: "text-success",
    dot: "bg-success",
    defaultLabel: "Active",
  },
  success: {
    bg: "bg-success/15",
    text: "text-success",
    dot: "bg-success",
    defaultLabel: "Success",
  },
  inactive: {
    bg: "bg-muted",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground",
    defaultLabel: "Inactive",
  },
  pending: {
    bg: "bg-warning/15",
    text: "text-warning",
    dot: "bg-warning",
    defaultLabel: "Pending",
  },
  warning: {
    bg: "bg-warning/15",
    text: "text-warning",
    dot: "bg-warning",
    defaultLabel: "Warning",
  },
  error: {
    bg: "bg-destructive/15",
    text: "text-destructive",
    dot: "bg-destructive",
    defaultLabel: "Error",
  },
  default: {
    bg: "bg-muted",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground",
    defaultLabel: "",
  },
}

function StatusBadge({
  status,
  label,
  showDot = true,
  className,
}: StatusBadgeProps) {
  const config = statusConfig[status]
  const displayLabel = label || config.defaultLabel

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full",
        config.bg,
        config.text,
        className
      )}
    >
      {showDot && (
        <span className={cn("w-1.5 h-1.5 rounded-full", config.dot)} />
      )}
      {displayLabel}
    </span>
  )
}

export { StatusBadge }
export type { StatusBadgeProps, StatusType }
