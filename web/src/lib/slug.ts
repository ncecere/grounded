/*
 * A slug suggested from a display name. The server accepts ASCII only (teams.ValidateSlug), so accents are dropped
 * (Ünï → uni), a few Latin letters get their usual spelling (ß → ss) and Cyrillic and Greek are romanised
 * (Привет → privet). A script with no mapping (Chinese, Japanese, Arabic, emoji) adds nothing and the name's other
 * words are kept. The result is "" rather than one letter, when nothing usable is left, or when it is reserved or
 * shaped like an ID: the form then asks for an address, or the server picks its default. Keep in step with
 * SlugFromName in internal/teams/slugname.go (#132).
 */
const letters: Record<string, string> = {
  ß: "ss", æ: "ae", œ: "oe", ø: "o", đ: "d", ð: "d", þ: "th", ł: "l", ı: "i", ħ: "h",
  // Cyrillic (й, ё and ї lose their mark when decomposed, so they come out as и, е and і).
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  і: "i", є: "ye", ґ: "g",
  // Greek (accents are already gone).
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n", ξ: "x", ο: "o", π: "p",
  ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};

/** The server's reserved slugs and its "looks like an ID" rule (teams.ValidateSlug). */
const reserved = new Set(["id", "admin", "api", "v1", "new", "auth", "assets", "static", "me", "teams", "agents"]);
const idShape = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/;

export function slugFromName(name: string, max = 63): string {
  const ascii = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^\x00-\x7f]/gu, (c) => letters[c] ?? " ");
  let s = ascii
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  if (s.length < 2 || reserved.has(s) || idShape.test(s)) s = "";
  return s;
}
