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

/** Amounts are exact to six decimals (docs/costs.md). */
const exactDecimals = 6;

function currencyFormat(n: number, currency: string, min: number, max: number): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: min, maximumFractionDigits: max }).format(n);
  } catch {
    // An unknown currency code: the number and the code.
    return `${new Intl.NumberFormat(undefined, { minimumFractionDigits: min, maximumFractionDigits: max }).format(n)} ${currency}`;
  }
}

/**
 * An amount of money for people, in cents ("$1,234.50", "$0.14"): amounts
 * travel as exact decimal strings (docs/costs.md) and are rounded only here,
 * so totals stay the sums of their rows. An amount under a cent reads
 * "< $0.01" (never a misleading "$0.00"), zero reads "$0.00", and no amount
 * "—". The currency is an ISO code, with no conversion. Show the exact
 * amount on hover with <Money> (components/money.tsx) or formatMoneyExact.
 */
export function formatMoney(amount: string | number | null | undefined, currency: string): string {
  if (amount == null || amount === "") return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  if (n > 0 && n < 0.01) return `< ${currencyFormat(0.01, currency, 2, 2)}`;
  return currencyFormat(n, currency, 2, 2);
}

/**
 * The exact amount ("$0.027129", "$5.00"): two decimals at least and as many
 * as the stored value has, up to six. For hover text, and for prices, which
 * are rates set to a fraction of a cent.
 */
export function formatMoneyExact(amount: string | number | null | undefined, currency: string): string {
  if (amount == null || amount === "") return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  return currencyFormat(n, currency, 2, exactDecimals);
}
