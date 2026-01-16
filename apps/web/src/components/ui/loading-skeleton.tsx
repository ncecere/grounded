import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

type SkeletonVariant = "page" | "table" | "card" | "form" | "stats"

interface LoadingSkeletonProps {
  variant: SkeletonVariant
  count?: number
  className?: string
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function TableSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="bg-muted px-6 py-3 flex gap-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-20 ml-auto" />
      </div>
      {/* Rows */}
      <div className="divide-y divide-border">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="px-6 py-4 flex items-center gap-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-20 ml-auto" />
          </div>
        ))}
      </div>
    </div>
  )
}

function CardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border p-6 space-y-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  )
}

function FormSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="rounded-lg border border-border p-6 space-y-6">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <div className="flex justify-end gap-3 pt-4">
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-24" />
      </div>
    </div>
  )
}

function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function LoadingSkeleton({ variant, count, className }: LoadingSkeletonProps) {
  const wrapperClass = cn("animate-pulse", className)

  switch (variant) {
    case "page":
      return (
        <div className={wrapperClass}>
          <PageSkeleton />
        </div>
      )
    case "table":
      return (
        <div className={wrapperClass}>
          <TableSkeleton count={count} />
        </div>
      )
    case "card":
      return (
        <div className={wrapperClass}>
          <CardSkeleton count={count} />
        </div>
      )
    case "form":
      return (
        <div className={wrapperClass}>
          <FormSkeleton count={count} />
        </div>
      )
    case "stats":
      return (
        <div className={wrapperClass}>
          <StatsSkeleton count={count} />
        </div>
      )
    default:
      return null
  }
}

export { LoadingSkeleton }
export type { LoadingSkeletonProps, SkeletonVariant }
