import type { ReactNode } from "react";
import styles from "./ErrorNotice.module.css";

interface ErrorNoticeProps {
  children: ReactNode;
  title: string;
}

export function ErrorNotice({ children, title }: ErrorNoticeProps) {
  return (
    <div className={styles.notice} role="alert">
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  );
}
