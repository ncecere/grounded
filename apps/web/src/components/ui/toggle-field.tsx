import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

interface ToggleFieldProps {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

export function ToggleField({
  label,
  description,
  checked,
  onCheckedChange,
  disabled = false,
  className,
}: ToggleFieldProps) {
  return (
    <div className={cn("flex items-center justify-between", className)}>
      <div className="space-y-0.5">
        <label className="text-sm font-medium text-foreground">{label}</label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  )
}
