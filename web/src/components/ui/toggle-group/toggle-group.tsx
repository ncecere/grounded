"use client";

import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import { createContext, useContext } from "react";
import { Toggle, type ToggleProps, type ToggleSize, type ToggleVariant } from "@/components/ui/toggle/toggle";
import { cx, dataFlag } from "@/lib/bitop-utils";
import styles from "./toggle-group.module.css";

/*
 * ToggleGroup: shared pressed state for a row (or column) of toggles, built
 * on Base UI ToggleGroup. One item at a time by default; `multiple` allows
 * several. Arrow keys move focus between items (roving tabindex), and the
 * group is a role="group" that must be named.
 *
 *   <ToggleGroup aria-label="Text alignment" defaultValue={["left"]}>
 *     <ToggleGroupItem value="left" iconOnly aria-label="Align left"><AlignLeft aria-hidden /></ToggleGroupItem>
 *     ...
 *   </ToggleGroup>
 *
 * Items are Toggles: variant and size come from the group.
 */

type GroupStyle = { variant: ToggleVariant; size: ToggleSize };
const GroupContext = createContext<GroupStyle>({ variant: "ghost", size: "md" });

type ToggleGroupBaseProps = Omit<BaseToggleGroup.Props, "className"> & {
  variant?: ToggleVariant;
  size?: ToggleSize;
  /** Join items into one segmented control (shared borders, no gaps). */
  joined?: boolean;
  className?: string;
};

/** The group needs an accessible name: pass `aria-label` or `aria-labelledby`. */
export type ToggleGroupProps = ToggleGroupBaseProps & ({ "aria-label": string } | { "aria-labelledby": string });

export function ToggleGroup({
  variant = "ghost",
  size = "md",
  joined = false,
  orientation = "horizontal",
  className,
  children,
  ...props
}: ToggleGroupProps) {
  return (
    <BaseToggleGroup
      {...props}
      orientation={orientation}
      data-variant={variant}
      data-size={size}
      data-joined={dataFlag(joined)}
      className={cx(styles.group, className)}
    >
      <GroupContext.Provider value={{ variant, size }}>{children}</GroupContext.Provider>
    </BaseToggleGroup>
  );
}

/** A Toggle inside a ToggleGroup. `value` identifies it in the group's value array. */
export type ToggleGroupItemProps = Omit<ToggleProps, "variant" | "size" | "value"> & { value: string };

export function ToggleGroupItem({ className, ...props }: ToggleGroupItemProps) {
  const { variant, size } = useContext(GroupContext);
  return <Toggle {...(props as ToggleProps)} variant={variant} size={size} className={cx(styles.item, className)} />;
}
