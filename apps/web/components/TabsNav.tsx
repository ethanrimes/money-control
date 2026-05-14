"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "./SignOutButton";

const TABS = [
  { href: "/", label: "Dashboard" },
  { href: "/budget", label: "Budget" },
  { href: "/historical-avg", label: "Historical avg" },
];

export function TabsNav() {
  const pathname = usePathname();
  if (pathname?.startsWith("/login") || pathname?.startsWith("/auth")) return null;
  return (
    <nav className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-7xl items-center gap-1 px-4">
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`relative px-4 py-3 text-sm transition ${
                active
                  ? "font-medium text-text"
                  : "text-muted hover:text-text"
              }`}
            >
              {t.label}
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 bg-accent" />
              )}
            </Link>
          );
        })}
        <div className="ml-auto pr-2">
          <SignOutButton />
        </div>
      </div>
    </nav>
  );
}
