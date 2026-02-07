interface DateRangeInputProps {
  dateRange: { startDate: string; endDate: string };
  onChange: (dateRange: { startDate: string; endDate: string }) => void;
}

export function DateRangeInput({ dateRange, onChange }: DateRangeInputProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={dateRange.startDate}
        onChange={(e) => onChange({ ...dateRange, startDate: e.target.value })}
        className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:ring-primary"
      />
      <span className="text-muted-foreground">to</span>
      <input
        type="date"
        value={dateRange.endDate}
        onChange={(e) => onChange({ ...dateRange, endDate: e.target.value })}
        className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:ring-primary"
      />
    </div>
  );
}
