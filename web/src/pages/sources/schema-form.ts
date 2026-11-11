/*
 * A connector's settings form, built from the JSON Schema its type declares (docs/source-types.md).
 *
 * Supported: an object whose properties are a string (an `enum` makes a choice), a boolean, an integer or number, or a
 * list of strings. `title` is the label and `description` the help; `required` marks what must be filled; `default`
 * starts a new form; `x-order` lists the properties in the order to show them (JSON objects have none), and
 * `x-multiline` makes a string a text area. Anything else is left to the server, which checks the settings itself.
 */
export type SchemaProperty = {
  type?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  items?: { type?: string };
  "x-multiline"?: boolean;
};

export type SettingsSchema = {
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  "x-order"?: string[];
};

export type FieldKind = "text" | "multiline" | "choice" | "boolean" | "number" | "list";

export type SchemaField = {
  key: string;
  label: string;
  help?: string;
  kind: FieldKind;
  required: boolean;
  options: string[];
  integer: boolean;
  property: SchemaProperty;
};

export type SettingsValues = Record<string, string | boolean | string[]>;

const titleCase = (key: string) => key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (ch) => ch.toUpperCase());

function kindOfProperty(p: SchemaProperty): FieldKind | undefined {
  switch (p.type) {
    case "string":
      return Array.isArray(p.enum) ? "choice" : p["x-multiline"] ? "multiline" : "text";
    case "boolean":
      return "boolean";
    case "integer":
    case "number":
      return "number";
    case "array":
      return p.items?.type === "string" ? "list" : undefined;
    default:
      return undefined;
  }
}

/** The fields of a settings schema, in `x-order` (then by name). Properties the form can't show are left out. */
export function schemaFields(schema: unknown): SchemaField[] {
  const s = (schema ?? {}) as SettingsSchema;
  const props = s.properties ?? {};
  const order = s["x-order"] ?? [];
  const keys = [...order.filter((k) => k in props), ...Object.keys(props).filter((k) => !order.includes(k)).sort()];
  const fields: SchemaField[] = [];
  for (const key of keys) {
    const property = props[key]!;
    const kind = kindOfProperty(property);
    if (!kind) continue;
    fields.push({
      key,
      label: property.title ?? titleCase(key),
      help: property.description,
      kind,
      required: s.required?.includes(key) ?? false,
      options: (property.enum ?? []).map(String),
      integer: property.type === "integer",
      property,
    });
  }
  return fields;
}

/** The form's starting values: what is stored (editing), else each property's default. Numbers are kept as text. */
export function initialValues(fields: SchemaField[], stored?: Record<string, unknown>): SettingsValues {
  const out: SettingsValues = {};
  for (const f of fields) {
    const v = stored?.[f.key] ?? f.property.default;
    if (f.kind === "boolean") out[f.key] = v === true;
    else if (f.kind === "list") out[f.key] = Array.isArray(v) ? v.map(String) : [];
    else out[f.key] = v === undefined || v === null ? "" : String(v);
  }
  return out;
}

/** What is wrong with each field, by key. */
export function validateSettings(fields: SchemaField[], values: SettingsValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = values[f.key];
    const empty = v === undefined || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "string" && v.trim() === "");
    if (f.required && empty && f.kind !== "boolean") {
      errors[f.key] = `Enter ${f.label.toLowerCase()}.`;
      continue;
    }
    if (f.kind !== "number" || empty) continue;
    const n = Number(v);
    const { minimum, maximum } = f.property;
    if (!Number.isFinite(n) || (f.integer && !Number.isInteger(n))) errors[f.key] = f.integer ? "Enter a whole number." : "Enter a number.";
    else if (minimum !== undefined && n < minimum) errors[f.key] = `Enter ${minimum} or more.`;
    else if (maximum !== undefined && n > maximum) errors[f.key] = `Enter ${maximum} or less.`;
  }
  return errors;
}

/** The settings as the API takes them: empty optional fields are left out, numbers are numbers. */
export function settingsBody(fields: SchemaField[], values: SettingsValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (f.kind === "boolean") out[f.key] = v === true;
    else if (f.kind === "list") {
      if (Array.isArray(v) && v.length > 0) out[f.key] = v;
    } else if (typeof v === "string" && v.trim() !== "") out[f.key] = f.kind === "number" ? Number(v) : v.trim();
  }
  return out;
}
