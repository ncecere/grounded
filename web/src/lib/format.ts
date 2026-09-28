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
