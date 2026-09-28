/** Formatting helpers shared by pages. */
import { formatBytes as formatBytesIEC } from "./bitop-format";

/** A medium date and short time in the user's locale, or "—" when missing. */
export function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * A size for people, the same everywhere: IEC units (1 KiB = 1,024 B), as
 * storage limits are set in GiB. "812 B", "4.3 KiB", "93 MiB", "10 GiB".
 */
export function formatStorage(bytes: number): string {
  return formatBytesIEC(bytes, { binary: true });
}

/**
 * An amount of money in the platform currency ("$1,234.50", "€0.0042"), for
 * display only: amounts travel as exact decimal strings (docs/costs.md), and
 * the currency is an ISO code with no conversion. Small non-zero amounts keep
 * up to four decimals so a few tokens don't read as zero.
 */
export function formatMoney(amount: string | null | undefined, currency: string): string {
  if (amount == null || amount === "") return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  const small = n !== 0 && Math.abs(n) < 1;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: small ? 4 : 2 }).format(n);
  } catch {
    return `${n.toFixed(small ? 4 : 2)} ${currency}`;
  }
}
