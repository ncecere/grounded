/* Field validation messages shared by forms (F-05: say what's wrong, not only a red border). */

/*
 * What the server accepts (teams.NormalizeEmail: the address, trimmed and lower-cased, parses with Go's
 * mail.ParseAddress as itself, 254 bytes at most): a dot-atom, @, then a dot-atom or an IP address in
 * brackets. A dot-atom is atext characters (visible ASCII except ( ) < > [ ] : ; @ \ , " and any non-ASCII
 * character) in groups separated by single dots. A host needs no dot: name@localhost is an address.
 */
const atext = "[!#-'*+\\-/-9=?A-Z^-~\\u{80}-\\u{10FFFF}]";
const dotAtom = `${atext}+(?:\\.${atext}+)*`;
const ipLiteral = "\\[(?:\\d{1,3}(?:\\.\\d{1,3}){3}|[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*)\\]";
const emailRE = new RegExp(`^${dotAtom}@(?:${dotAtom}|${ipLiteral})$`, "u");

/** A model's or embedding profile's key: catalog.keyRE on the server, 1 to 63 of a-z 0-9 . _ -, starting with a letter or digit. */
const keyRE = /^[a-z0-9][a-z0-9._-]{0,62}$/;

/** A message for a key field (Add model, Add profile), or null when it is fine; for Field's `validate`. */
export function keyProblem(key: string): string | null {
  if (!key) return "Enter a key.";
  return keyRE.test(key) ? null : "Use lowercase letters, digits, dots, hyphens and underscores, starting with a letter or digit (63 characters at most).";
}

/** A message for an email field, or undefined when it looks fine. */
export function emailProblem(email: string) {
  const v = email.trim();
  if (!v) return "Enter an email address.";
  if (!emailRE.test(v) || new TextEncoder().encode(v).length > 254) return "Enter an email address like name@example.org.";
  return undefined;
}
