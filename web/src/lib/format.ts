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
const maxMoneyDecimals = 6;

/**
 * The fewest decimals, from 2 to 6, that show every amount exactly: use one
 * count for a whole table column (and its total) so the decimals line up and
 * "$0.01" is never a rounded "$0.0100".
 */
export function moneyDecimals(...amounts: (string | number | null | undefined)[]): number {
  let most = 2;
  for (const a of amounts) {
    if (a == null || a === "") continue;
    let fraction: string;
    if (typeof a === "string" && /^-?\d*(\.\d*)?$/.test(a.trim())) fraction = a.trim().split(".")[1] ?? "";
    else if (Number.isFinite(Number(a))) fraction = Number(a).toFixed(maxMoneyDecimals).split(".")[1] ?? "";
    else continue;
    most = Math.max(most, Math.min(maxMoneyDecimals, fraction.replace(/0+$/, "").length));
  }
  return most;
}

/**
 * An amount of money in the platform currency ("$1,234.50", "€0.0042"), for
 * display only: amounts travel as exact decimal strings (docs/costs.md), and
 * the currency is an ISO code with no conversion. It shows `decimals`
 * decimals, with trailing zeros; by default as many as the amount needs
 * (2 to 6), so a few tokens don't read as zero. Pass moneyDecimals(column)
 * for amounts in a table column.
 */
export function formatMoney(amount: string | number | null | undefined, currency: string, decimals = moneyDecimals(amount)): string {
  if (amount == null || amount === "") return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return String(amount);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
  } catch {
    return `${n.toFixed(decimals)} ${currency}`;
  }
}
