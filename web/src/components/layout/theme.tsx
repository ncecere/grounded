/*
 * Light and dark (VI-38): the app follows the system's setting unless the
 * person chooses Light or Dark in the account menu. The choice is kept in
 * this browser (bitop-ui color-mode, localStorage). public/color-mode.js sets
 * <html data-theme> before the first paint; ColorModeSync keeps it in step
 * with the system's setting and with other tabs while the app is open. The
 * public page and the widget have no account menu: they follow the system
 * (or a choice made in this browser on this site).
 */
import { useColorMode, type ColorMode } from "@/components/ui/color-mode/color-mode";
import { MenuRadioGroup, MenuRadioItem } from "@/components/ui/menu/menu";

const MODES: { value: ColorMode; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const isMode = (v: unknown): v is ColorMode => MODES.some((m) => m.value === v);

/** Follows the system's light or dark setting and other tabs' choices on every page. */
export function ColorModeSync() {
  useColorMode();
  return null;
}

/** System / Light / Dark, in the account menu. */
export function ThemeMenuGroup() {
  const { mode, setMode } = useColorMode();
  return (
    <MenuRadioGroup label="Theme" value={mode} onValueChange={(v) => isMode(v) && setMode(v)}>
      {MODES.map((m) => (
        <MenuRadioItem key={m.value} value={m.value}>
          {m.label}
        </MenuRadioItem>
      ))}
    </MenuRadioGroup>
  );
}
