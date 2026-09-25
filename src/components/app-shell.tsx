"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Four tabs, one question each: what now, what's coming, how am I doing,
 * how is it built. Every other screen belongs to one of them, and that
 * tab stays lit while you are there — you are never nowhere.
 */
const PRIMARY = [
  { href: "/", label: "Hoy", owns: ["/movilidad"] },
  { href: "/semana", label: "Semana", owns: ["/fuerza", "/carrera"] },
  { href: "/progreso", label: "Progreso", owns: [] },
  {
    href: "/programa",
    label: "Plan",
    owns: ["/editor", "/motor", "/ajustes", "/generar"],
  },
] as const;

/** Plan's own screens, one click away on the desktop rail. */
const PLAN_SCREENS = [
  { href: "/editor", label: "Semana tipo" },
  { href: "/motor", label: "Motor" },
  { href: "/ajustes", label: "Ajustes" },
] as const;

function isActive(pathname: string, item: (typeof PRIMARY)[number]) {
  if (item.href === "/") {
    return pathname === "/" || item.owns.some((p) => pathname.startsWith(p));
  }
  return (
    pathname.startsWith(item.href) ||
    item.owns.some((p) => pathname.startsWith(p))
  );
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
  // The runner pins its own action bar to the bottom edge; a tab strip
  // directly under "Hecho" is pure mis-tap surface mid-set.
  const inRunner = pathname.startsWith("/sesion/");

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <nav className="hidden w-[232px] flex-none flex-col border-r border-line bg-chrome md:flex">
        <div className="px-[22px] pt-[26px] pb-[22px]">
          <div className="font-display text-[14px] leading-none font-bold tracking-[0.18em]">
            BLOQUES
          </div>
          {seasonLabel ? (
            <div className="mt-1.5 text-[11px] leading-none text-faint">
              {seasonLabel}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-0.5 px-3">
          {PRIMARY.map((item) => {
            const active = isActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "font-display border-l-[3px] px-3 py-[11px] text-[12px] leading-none tracking-[0.1em] uppercase",
                  active
                    ? "rounded-md border-lime-line bg-lime-soft font-bold text-lime"
                    : "border-transparent font-semibold text-mid hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="mt-1 flex flex-col gap-0.5 pl-6">
            {PLAN_SCREENS.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "px-3 py-2 text-[13px] leading-none",
                    active ? "font-semibold text-ink" : "text-mid hover:text-ink",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="mt-auto px-[22px] py-[22px] text-[11px] leading-[1.5] text-faint">
          El motor calcula el peso. Tú solo levantas.
        </div>
      </nav>

      <div className="relative flex min-h-dvh min-w-0 flex-1 flex-col">
        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col md:pb-0",
            inRunner
              ? "pb-[var(--safe-bottom)]"
              : "pb-[calc(58px+var(--safe-bottom))]",
          )}
        >
          <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col md:max-w-none">
            {children}
          </div>
        </main>

        {/* The padding lives on the anchors, not the nav: these are the tab
            targets the athlete hits mid-workout. */}
        {inRunner ? null : (
          <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-chrome px-2 pb-[calc(8px+var(--safe-bottom))] md:hidden">
            {PRIMARY.map((item) => {
              const active = isActive(pathname, item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "font-display flex h-11 flex-1 items-center justify-center text-[12px] leading-none tracking-[0.08em] uppercase",
                    active ? "font-bold text-lime" : "font-semibold text-mid",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
