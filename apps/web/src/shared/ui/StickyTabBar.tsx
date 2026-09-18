import type { ReactNode } from "react";
import styles from "./StickyTabBar.module.css";

export function StickyTabBar({
  label,
  actionsLabel = "Tab actions",
  actions,
  children,
  fit = false,
}: {
  label: string;
  actionsLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
  fit?: boolean;
}) {
  return (
    <div className={styles.bar}>
      <div
        className={styles.tabs}
        data-fit={fit}
        role="tablist"
        aria-label={label}
      >
        {children}
      </div>
      {actions ? (
        <div className={styles.actions} role="group" aria-label={actionsLabel}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}
