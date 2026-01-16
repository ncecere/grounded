import { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"

type IconColor = "primary" | "success" | "warning" | "destructive" | "muted" | "green" | "purple" | "orange" | "blue"

interface StatCardProps {
  label: string
  value: string | number
  icon?: LucideIcon
  iconColor?: IconColor
  subtext?: string
  className?: string
}

const iconColorClasses: Record<IconColor, string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/20 text-success",
  warning: "bg-warning/20 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  muted: "bg-muted text-muted-foreground",
  green: "bg-green-500/10 text-green-600 dark:text-green-400",
  purple: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  orange: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
}

function StatCard({
  label,
  value,
  icon: Icon,
  iconColor = "primary",
  subtext,
  className,
}: StatCardProps) {
  return (
    <Card className={cn("", className)}>
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          {Icon && (
            <div className={cn("p-2 rounded-lg", iconColorClasses[iconColor])}>
              <Icon className="w-5 h-5" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground truncate">{label}</p>
            <p className="text-2xl font-bold text-foreground font-mono tabular-nums">
              {value}
            </p>
            {subtext && (
              <p className="text-xs text-muted-foreground mt-0.5">{subtext}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export { StatCard }
export type { StatCardProps, IconColor }
