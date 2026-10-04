import type { ReactNode } from "react";

interface PanelProps {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  testId?: string;
}

/** A bordered terminal pane with a compact title row. */
export default function Panel({ title, aside, children, className = "", bodyClassName = "", testId }: PanelProps) {
  return (
    <section
      data-testid={testId}
      className={`flex min-h-0 min-w-0 flex-col border border-rule bg-panel ${className}`}
    >
      <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-rule px-3">
        <h2 className="truncate text-[13px] font-medium text-text">{title}</h2>
        {aside ? <div className="flex items-center gap-2 text-xs text-dim">{aside}</div> : null}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
