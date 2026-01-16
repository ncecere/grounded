import * as React from "react"
import { ChevronLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface PageHeaderProps {
  title: React.ReactNode
  description?: string
  actions?: React.ReactNode
  backButton?: {
    label?: string
    onClick: () => void
  }
  className?: string
}

function PageHeader({
  title,
  description,
  actions,
  backButton,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between mb-6", className)}>
      <div className="flex items-center gap-4">
        {backButton && (
          <Button
            variant="ghost"
            size="icon"
            onClick={backButton.onClick}
            className="h-8 w-8"
          >
            <ChevronLeft className="h-5 w-5" />
            <span className="sr-only">{backButton.label || "Go back"}</span>
          </Button>
        )}
        <div>
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  )
}

export { PageHeader }
export type { PageHeaderProps }
