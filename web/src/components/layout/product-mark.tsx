/*
 * Grounded's logo (the "Cited" mark: a citation's brackets around a check), shown where an instance has no logo of its own
 * (UI_LOGO_URL). It is the exact brand file from public/, not theme colours, so a theme never recolours the product's logo.
 */
export function ProductMark({ className, small }: { className?: string; small?: boolean }) {
  // The small version (heavier strokes) reads better at about 32 px and below, such as the sidebar.
  return <img src={small ? "/grounded-mark-small.svg" : "/grounded-mark.svg"} alt="" className={className} />;
}
