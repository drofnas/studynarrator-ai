import type { ReactNode } from "react";
import styles from "./StickyTabBar.module.css";

export function StickyTabBar({
  label,
  actionsLabel = "Tab actions",
  actions,
  children,
}: {
  label: string;
  actionsLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.bar}>
      <div className={styles.tabs} role="tablist" aria-label={label}>
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
