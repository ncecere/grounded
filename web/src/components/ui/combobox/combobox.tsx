"use client";

import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { type ReactNode, useMemo, useRef } from "react";
import popup from "@/components/ui/styles/popup.module.css";
import { cx } from "@/lib/bitop-utils";
import styles from "./combobox.module.css";

/*
 * Combobox: a filterable select (Base UI Combobox). Type to filter, ↑/↓ to
 * move, Enter to pick, Esc to close. Single or multiple selection; in
 * multiple mode the picks show as chips inside the input (← from the start
 * of the input moves onto them, Backspace/Delete removes one).
 *
 *   <Field label="Country" description="Where the account is billed.">
 *     <Combobox items={countries} value={code} onValueChange={setCode} clearable />
 *   </Field>
 *
 *   <Field label="Reviewers">
 *     <Combobox multiple items={people} defaultValue={["ana"]} />
 *   </Field>
 *
 * The input is a Base UI Field control: inside <Field> it is labelled,
 * described and marked invalid. Standalone, pass `aria-label`. Items that
 * share a `group` are shown under a heading. Values are the items' string
 * `value`s; the input shows and filters by `label`.
 *
 * Use Select when there are only a handful of options, and NativeSelect in
 * plain forms.
 */

export type ComboboxOption<V extends string = string> = {
  value: V;
  label: string;
  /** Decorative icon shown before the label. */
  icon?: ReactNode;
  /** Muted secondary text shown at the end of the row. */
  hint?: ReactNode;
  /** Group heading; options with the same group are listed together. */
  group?: string;
  disabled?: boolean;
};

type ComboboxBaseProps<V extends string> = {
  items: ComboboxOption<V>[];
  placeholder?: string;
  /** Shown (and announced) when nothing matches the typed text. */
  emptyText?: ReactNode;
  /** Show a button that clears the selection. */
  clearable?: boolean;
  /** Accessible name of the clear button. */
  clearLabel?: string;
  /** Accessible name of the button that opens the list. */
  triggerLabel?: string;
  /** Accessible name when the combobox is not inside a labelled Field. */
  "aria-label"?: string;
  /** Called as the user types. */
  onInputValueChange?: (text: string) => void;
  /** Highlight the first match while typing, so Enter picks it. */
  autoHighlight?: boolean;
  /** Most options to render at once (long lists). */
  limit?: number;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  name?: string;
  id?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  size?: "sm" | "md";
  className?: string;
};

export type ComboboxSingleProps<V extends string = string> = ComboboxBaseProps<V> & {
  multiple?: false;
  value?: V | null;
  defaultValue?: V | null;
  onValueChange?: (value: V | null, option: ComboboxOption<V> | null) => void;
};

export type ComboboxMultipleProps<V extends string = string> = ComboboxBaseProps<V> & {
  multiple: true;
  value?: V[];
  defaultValue?: V[];
  onValueChange?: (value: V[], options: ComboboxOption<V>[]) => void;
  /** Accessible name of the chip list, e.g. "Selected reviewers". */
  chipsLabel?: string;
};

export type ComboboxProps<V extends string = string> = ComboboxSingleProps<V> | ComboboxMultipleProps<V>;

type OptionGroup<V extends string> = { value: string; items: ComboboxOption<V>[] };

function groupOptions<V extends string>(items: ComboboxOption<V>[]): OptionGroup<V>[] {
  const groups = new Map<string, ComboboxOption<V>[]>();
  for (const item of items) {
    const key = item.group ?? "";
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return [...groups].map(([value, list]) => ({ value, items: list }));
}

export function Combobox<V extends string = string>(props: ComboboxProps<V>) {
  const {
    items,
    placeholder,
    emptyText = "No results.",
    clearable = false,
    clearLabel = "Clear selection",
    triggerLabel = "Show options",
    "aria-label": ariaLabel,
    onInputValueChange,
    autoHighlight,
    limit,
    open,
    defaultOpen,
    onOpenChange,
    name,
    id,
    disabled,
    readOnly,
    required,
    size = "md",
    className,
  } = props;

  const anchorRef = useRef<HTMLDivElement | null>(null);
  const grouped = items.some((item) => item.group !== undefined);
  const byValue = useMemo(() => new Map(items.map((item) => [item.value, item])), [items]);
  const collection = useMemo(() => {
    const getters = { getValue: (o: ComboboxOption<V>) => o.value, getLabel: (o: ComboboxOption<V>) => o.label };
    return grouped ? BaseCombobox.createItems(groupOptions(items), getters) : BaseCombobox.createItems(items, getters);
  }, [items, grouped]);

  const labelOf = (value: V) => byValue.get(value)?.label ?? value;

  const handleValueChange = (next: unknown) => {
    if (props.multiple) {
      const values = (next as V[] | null) ?? [];
      props.onValueChange?.(values, values.flatMap((v) => byValue.get(v) ?? []));
    } else {
      const value = (next as V | null) ?? null;
      props.onValueChange?.(value, value === null ? null : (byValue.get(value) ?? null));
    }
  };

  const renderItem = (item: ComboboxOption<V>) => (
    <BaseCombobox.Item key={item.value} value={item.value} disabled={item.disabled} className={cx(popup.item, styles.item)}>
      {item.icon && (
        <span aria-hidden className={styles.itemIcon}>
          {item.icon}
        </span>
      )}
      <span className={styles.itemText}>{item.label}</span>
      {item.hint && <span className={styles.hint}>{item.hint}</span>}
      <BaseCombobox.ItemIndicator className={styles.indicator}>
        <Check aria-hidden />
      </BaseCombobox.ItemIndicator>
    </BaseCombobox.Item>
  );

  const input = (hasChips: boolean) => (
    <BaseCombobox.Input
      id={id}
      aria-label={ariaLabel}
      placeholder={hasChips ? undefined : placeholder}
      className={cx(styles.input, props.multiple && styles.chipInput)}
    />
  );

  return (
    <BaseCombobox.Root
      items={collection as never}
      multiple={props.multiple ?? false}
      value={props.value as never}
      defaultValue={props.defaultValue as never}
      onValueChange={handleValueChange}
      onInputValueChange={onInputValueChange ? (text) => onInputValueChange(text) : undefined}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}
      autoHighlight={autoHighlight}
      limit={limit}
      name={name}
      disabled={disabled}
      readOnly={readOnly}
      required={required}
    >
      <BaseCombobox.InputGroup ref={anchorRef} data-size={size} className={cx(styles.control, className)}>
        {props.multiple ? (
          <BaseCombobox.Value>
            {(selected: V[]) => (
              <BaseCombobox.Chips className={styles.chips} aria-label={selected.length > 0 ? (props.chipsLabel ?? "Selected") : undefined}>
                {selected.map((value) => (
                  <BaseCombobox.Chip key={value} className={styles.chip}>
                    <span className={styles.chipText}>{labelOf(value)}</span>
                    <BaseCombobox.ChipRemove className={styles.chipRemove} aria-label={`Remove ${labelOf(value)}`}>
                      <X aria-hidden />
                    </BaseCombobox.ChipRemove>
                  </BaseCombobox.Chip>
                ))}
                {input(selected.length > 0)}
              </BaseCombobox.Chips>
            )}
          </BaseCombobox.Value>
        ) : (
          input(false)
        )}
        <div className={styles.actions}>
          {clearable && (
            <BaseCombobox.Clear className={styles.action} aria-label={clearLabel}>
              <X aria-hidden />
            </BaseCombobox.Clear>
          )}
          <BaseCombobox.Trigger className={styles.action} aria-label={triggerLabel}>
            <ChevronsUpDown aria-hidden />
          </BaseCombobox.Trigger>
        </div>
      </BaseCombobox.InputGroup>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner className={popup.positioner} anchor={anchorRef} align="start" sideOffset={6}>
          <BaseCombobox.Popup className={cx(popup.popup, styles.popup)}>
            <BaseCombobox.Empty className={styles.empty}>{emptyText}</BaseCombobox.Empty>
            <BaseCombobox.List className={styles.list}>
              {grouped
                ? (group: OptionGroup<V>) => (
                    <BaseCombobox.Group key={group.value} items={group.items} className={styles.group}>
                      {group.value && <BaseCombobox.GroupLabel className={popup.groupLabel}>{group.value}</BaseCombobox.GroupLabel>}
                      <BaseCombobox.Collection>{renderItem}</BaseCombobox.Collection>
                    </BaseCombobox.Group>
                  )
                : renderItem}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}
