import { cn } from "@/lib/utils"

interface QueryChartData {
  date: string
  count: number
  errors?: number
}

interface QueryChartProps {
  data: QueryChartData[]
  maxDays?: number
  className?: string
  emptyMessage?: string
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`
  }
  return num.toString()
}

export function QueryChart({
  data,
  maxDays = 14,
  className,
  emptyMessage = "No data available",
}: QueryChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className={cn("h-48 flex items-center justify-center text-muted-foreground", className)}>
        {emptyMessage}
      </div>
    )
  }

  const displayData = data.slice(-maxDays)
  const maxCount = Math.max(...displayData.map((d) => d.count))
  const yMax = Math.max(maxCount, 1)
  const yLabels = [yMax, Math.round(yMax * 0.75), Math.round(yMax * 0.5), Math.round(yMax * 0.25), 0]

  return (
    <div className={cn("h-48", className)}>
      <div className="flex h-40">
        {/* Y-axis labels */}
        <div className="flex flex-col justify-between text-xs text-muted-foreground pr-2 py-1 w-10">
          {yLabels.map((val, i) => (
            <span key={i} className="text-right">{formatNumber(val)}</span>
          ))}
        </div>
        
        {/* Chart area */}
        <div className="flex-1 border-l border-b border-border relative">
          {/* Grid lines */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {yLabels.map((_, i) => (
              <div key={i} className="border-t border-border/50 w-full" />
            ))}
          </div>
          
          {/* Bars */}
          <div className="absolute inset-0 flex items-end justify-around px-1 pb-1">
            {displayData.map((day, i) => {
              const heightPercent = yMax > 0 ? (day.count / yMax) * 100 : 0
              return (
                <div
                  key={i}
                  className="flex-1 flex justify-center max-w-[40px] h-full items-end"
                >
                  <div
                    className="w-4 bg-primary rounded-t hover:bg-primary/80 transition-colors relative group cursor-pointer"
                    style={{ height: `${Math.max(heightPercent, 2)}%` }}
                  >
                    {/* Tooltip */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded border border-border shadow-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                      {day.count} queries
                      {day.errors !== undefined && day.errors > 0 && `, ${day.errors} errors`}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      
      {/* X-axis labels */}
      <div className="flex ml-10 mt-1 justify-around px-1 overflow-hidden">
        {displayData.map((day, i) => (
          <div key={i} className="flex-1 max-w-[40px] text-center">
            <span className="text-xs text-muted-foreground">
              {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
