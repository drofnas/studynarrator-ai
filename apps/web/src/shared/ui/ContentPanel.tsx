import type { ReactNode } from "react";
import styles from "./ContentPanel.module.css";

interface ContentPanelProps {
  action: ReactNode;
  children: ReactNode;
  kicker: string;
  title: string;
  titleId: string;
}

export function ContentPanel({ action, children, kicker, title, titleId }: ContentPanelProps) {
  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <div className={styles.heading}>
        <div>
          <p className={styles.kicker}>{kicker}</p>
          <h2 className={styles.title} id={titleId}>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
