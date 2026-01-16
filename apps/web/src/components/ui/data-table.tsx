import { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"

interface Column<T> {
  key: string
  header: string
  className?: string
  render?: (item: T) => React.ReactNode
}

interface EmptyStateConfig {
  icon?: LucideIcon
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  isLoading?: boolean
  emptyState?: EmptyStateConfig
  onRowClick?: (item: T) => void
  getRowKey: (item: T) => string | number
  className?: string
}

function DataTable<T>({
  columns,
  data,
  isLoading = false,
  emptyState,
  onRowClick,
  getRowKey,
  className,
}: DataTableProps<T>) {
  if (isLoading) {
    return (
      <div className={cn("rounded-lg border border-border overflow-hidden", className)}>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {columns.map((col) => (
                <TableHead key={col.key} className={col.className}>
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {columns.map((col) => (
                  <TableCell key={col.key}>
                    <Skeleton className="h-4 w-full max-w-[200px]" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  if (data.length === 0 && emptyState) {
    return (
      <div className={cn("rounded-lg border border-border bg-card", className)}>
        <EmptyState
          icon={emptyState.icon}
          title={emptyState.title}
          description={emptyState.description}
          action={emptyState.action}
        />
      </div>
    )
  }

  return (
    <div className={cn("rounded-lg border border-border overflow-hidden", className)}>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            {columns.map((col) => (
              <TableHead key={col.key} className={col.className}>
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((item) => (
            <TableRow
              key={getRowKey(item)}
              className={cn(
                onRowClick && "cursor-pointer"
              )}
              onClick={() => onRowClick?.(item)}
            >
              {columns.map((col) => (
                <TableCell key={col.key} className={col.className}>
                  {col.render
                    ? col.render(item)
                    : String((item as Record<string, unknown>)[col.key] ?? "")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export { DataTable }
export type { DataTableProps, Column, EmptyStateConfig }
