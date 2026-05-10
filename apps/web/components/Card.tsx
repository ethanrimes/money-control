import type { ReactNode } from "react";

export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-sm font-medium text-muted">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted/80">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
