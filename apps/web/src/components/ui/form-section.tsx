import { cn } from "@/lib/utils"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

interface FormSectionProps {
  title?: string
  description?: string
  children: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

function FormSection({
  title,
  description,
  children,
  actions,
  className,
}: FormSectionProps) {
  return (
    <Card className={cn("", className)}>
      {(title || description) && (
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className={cn(!title && !description && "pt-6")}>
        {children}
      </CardContent>
      {actions && (
        <CardFooter className="flex justify-end gap-3 border-t bg-muted/50 px-6 py-4">
          {actions}
        </CardFooter>
      )}
    </Card>
  )
}

export { FormSection }
export type { FormSectionProps }
