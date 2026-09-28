/* Field validation messages shared by forms (F-05: say what's wrong, not only a red border). */

/** A message for an email field, or undefined when it looks fine. */
export function emailProblem(email: string) {
  const v = email.trim();
  if (!v) return "Enter an email address.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Enter an email address like name@example.org.";
  return undefined;
}
