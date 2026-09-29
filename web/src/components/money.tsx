/* An amount of money in cents, with the exact amount on hover (docs/costs.md: exact values stay in the API and CSV exports). */
import { formatMoney, formatMoneyExact } from "@/lib/format";

export function Money({ amount, currency }: { amount: string | number | null | undefined; currency: string }) {
  const shown = formatMoney(amount, currency);
  const exact = formatMoneyExact(amount, currency);
  if (exact === shown) return <>{shown}</>;
  return <span title={exact}>{shown}</span>;
}
