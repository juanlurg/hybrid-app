"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

const PRIMARY = [
  { href: "/", label: "Hoy" },
  { href: "/semana", label: "Semana" },
  { href: "/progreso", label: "Progreso" },
  { href: "/programa", label: "Programa" },
] as const;

const SECONDARY = [
  { href: "/historial", label: "Historial" },
  { href: "/editor", label: "Editar" },
  { href: "/ajustes", label: "Ajustes" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * Phone: content scrolls, tab bar pinned to the bottom.
 * Desktop: a fixed rail on the left and the same screens beside it —
 * a planning surface, not a stretched phone.
 */
export function AppShell({
  children,
  seasonLabel,
}: {
  children: ReactNode;
  seasonLabel?: string;
}) {
  const pathname = usePathname();
  const all = [...PRIMARY, ...SECONDARY];

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <nav className="hidden w-56 flex-none flex-col bg-ink text-paper md:flex">
        <div className="px-5 pt-6 pb-5">
          <div className="text-[11px] leading-none font-extrabold tracking-[0.18em]">
            BLOQUES
          </div>
          {seasonLabel ? (
            <div className="mt-2 text-[10px] leading-none font-medium opacity-50">
              {seasonLabel}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-px">
          {all.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "px-5 py-3.5 text-[12px] leading-none font-bold tracking-[0.08em] uppercase",
                  active
                    ? "bg-strength text-ink"
                    : "bg-ink text-ink-3 hover:text-paper",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        <div className="mt-auto px-5 py-5 text-[10px] leading-[1.5] opacity-40">
          El motor calcula el peso. Tú solo levantas.
        </div>
      </nav>

      <div className="relative flex min-h-dvh min-w-0 flex-1 flex-col">
        <main className="flex min-h-0 flex-1 flex-col pb-[calc(52px+var(--safe-bottom))] md:pb-0">
          <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col md:max-w-none">
            {children}
          </div>
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-30 flex gap-px bg-ink pb-[var(--safe-bottom)] md:hidden">
          {PRIMARY.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-13 flex-1 items-center justify-center text-[11px] leading-none tracking-[0.08em] uppercase",
                  active
                    ? "bg-strength font-extrabold text-ink"
                    : "bg-ink font-semibold text-ink-3",
                )}
                style={{ height: 52 }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

/** Secondary nav shown inside Programa on phones. */
export function SecondaryNav() {
  const pathname = usePathname();
  return (
    <div className="flex gap-px bg-line py-px md:hidden">
      {SECONDARY.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex-1 px-1 py-3 text-center text-[11px] leading-none font-bold tracking-[0.08em] uppercase",
              active ? "bg-ink text-paper" : "bg-paper text-mid",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
