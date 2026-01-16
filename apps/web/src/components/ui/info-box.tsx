import { LucideIcon, Info } from "lucide-react"
import { cn } from "@/lib/utils"

type InfoBoxVariant = "info" | "success" | "warning" | "destructive"

interface InfoBoxProps {
  variant?: InfoBoxVariant
  title?: string
  children: React.ReactNode
  icon?: LucideIcon
  className?: string
}

const variantClasses: Record<InfoBoxVariant, string> = {
  info: "bg-primary/10 border-primary/20 text-foreground [&_svg]:text-primary",
  success: "bg-success/10 border-success/20 text-foreground [&_svg]:text-success",
  warning: "bg-warning/10 border-warning/20 text-foreground [&_svg]:text-warning",
  destructive: "bg-destructive/10 border-destructive/20 text-foreground [&_svg]:text-destructive",
}

function InfoBox({
  variant = "info",
  title,
  children,
  icon: Icon = Info,
  className,
}: InfoBoxProps) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        variantClasses[variant],
        className
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          {title && (
            <h3 className="text-sm font-medium mb-1">{title}</h3>
          )}
          <div className="text-sm text-muted-foreground">{children}</div>
        </div>
      </div>
    </div>
  )
}

export { InfoBox }
export type { InfoBoxProps, InfoBoxVariant }
