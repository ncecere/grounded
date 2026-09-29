"use client";

import { useRender } from "@base-ui/react/use-render";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Menu, MenuLinkItem, type MenuLinkItemProps } from "@/components/ui/menu/menu";
import { cx } from "@/lib/bitop-utils";
import styles from "./breadcrumbs.module.css";

/*
 * A breadcrumb trail. A long trail can collapse its middle into one "…"
 * item that opens a menu of the hidden crumbs:
 *
 *   <Breadcrumbs items={[
 *     { label: "Acme", href: "/" },
 *     { label: "Show 3 hidden levels", collapsed: [{ label: "Projects", href: "/p" }, { label: "Web", href: "/p/web" }, { label: "Releases", href: "/p/web/r" }] },
 *     { label: "v2.1" },
 *   ]} />
 *
 * The collapsed item's `label` is the menu button's accessible name (it
 * shows "…"); its title lists the hidden crumbs as a path.
 */

export type BreadcrumbLink = {
  label: ReactNode;
  href?: string;
  /** Router link, e.g. `<Link to="/teams/$team" params={{ team }} />`. */
  render?: useRender.RenderProp;
  icon?: ReactNode;
};

export type BreadcrumbItem = BreadcrumbLink & {
  /** Crumbs hidden behind this item: it renders as a "…" button opening a menu of these links, named by `label`. */
  collapsed?: BreadcrumbLink[];
};

export type BreadcrumbsProps = {
  items: BreadcrumbItem[];
  /** Landmark name (default "Breadcrumb"). */
  label?: string;
  className?: string;
};

function Crumb({ item }: { item: BreadcrumbLink }) {
  return useRender({
    render: item.render,
    defaultTagName: "a",
    props: {
      href: item.href,
      className: styles.link,
      children: (
        <>
          {item.icon}
          {item.label}
        </>
      ),
    },
  });
}

/** The hidden crumbs as a path ("Projects › Web › Releases") when their labels are text. */
function pathTitle(items: BreadcrumbLink[]) {
  const labels = items.map((i) => (typeof i.label === "string" ? i.label : ""));
  return labels.every(Boolean) ? labels.join(" › ") : undefined;
}

/** "…": a menu button listing the hidden crumbs, in order. */
function Collapsed({ item }: { item: BreadcrumbItem & { collapsed: BreadcrumbLink[] } }) {
  return (
    <Menu
      trigger={
        <button type="button" className={styles.more} title={pathTitle(item.collapsed)}>
          <span aria-hidden>…</span>
          <span className={styles.srOnly}>{item.label}</span>
        </button>
      }
    >
      {item.collapsed.map((c, i) => (
        // A crumb's render is an element (a router link) or a render function taking link props, which a menu link item accepts too.
        <MenuLinkItem key={i} href={c.href} render={c.render as MenuLinkItemProps["render"]} icon={c.icon}>
          {c.label}
        </MenuLinkItem>
      ))}
    </Menu>
  );
}

/** A trail of links; the last item is the current page (aria-current="page"). */
export function Breadcrumbs({ items, label = "Breadcrumb", className }: BreadcrumbsProps) {
  return (
    <nav aria-label={label} className={cx(styles.nav, className)}>
      <ol className={styles.list}>
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className={styles.item}>
              {item.collapsed && item.collapsed.length > 0 && !last ? (
                <Collapsed item={{ ...item, collapsed: item.collapsed }} />
              ) : last ? (
                <span aria-current="page" className={styles.current}>
                  {item.icon}
                  {item.label}
                </span>
              ) : (
                <Crumb item={item} />
              )}
              {!last && <ChevronRight aria-hidden className={styles.separator} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
