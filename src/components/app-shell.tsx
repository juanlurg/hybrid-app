"use client";

import {
  CalendarDays,
  Layers,
  Sun,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Four tabs, one question each: what now, what's coming, how am I doing,
 * how is it built. Every other screen belongs to one of them, and that
 * tab stays lit while you are there — you are never nowhere.
 */
const PRIMARY: ReadonlyArray<{
  href: string;
  label: string;
  icon: LucideIcon;
  owns: readonly string[];
}> = [
  { href: "/", label: "Hoy", icon: Sun, owns: ["/movilidad"] },
  {
    href: "/semana",
    label: "Semana",
    icon: CalendarDays,
    owns: ["/fuerza", "/carrera"],
  },
  { href: "/progreso", label: "Progreso", icon: TrendingUp, owns: [] },
  {
    href: "/programa",
    label: "Plan",
    icon: Layers,
    owns: ["/editor", "/motor", "/ajustes", "/generar"],
  },
];

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
      <nav className="m-4 mr-0 hidden w-[232px] flex-none flex-col rounded-3xl bg-chrome shadow-float md:flex">
        <div className="px-[22px] pt-[26px] pb-[22px]">
          <div className="text-[17px] leading-none font-extrabold tracking-[-0.01em]">
            Bloques
          </div>
          {seasonLabel ? (
            <div className="mt-1.5 text-[12px] leading-none font-medium text-mid">
              {seasonLabel}
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-1 px-3">
          {PRIMARY.map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-full px-3 py-2.5 text-[14px] leading-none",
                  active
                    ? "bg-strength font-bold text-on-strength"
                    : "font-semibold text-mid hover:text-ink",
                )}
              >
                <Icon aria-hidden size={18} strokeWidth={2.1} />
                {item.label}
              </Link>
            );
          })}
          <div className="mt-1 flex flex-col gap-0.5 pl-8">
            {PLAN_SCREENS.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "px-3 py-2 text-[13px] leading-none",
                    active
                      ? "font-bold text-clay"
                      : "font-medium text-mid hover:text-ink",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="mt-auto px-[22px] py-[22px] text-[12px] leading-[1.5] font-medium text-mid">
          El motor calcula el peso. Tú solo levantas.
        </div>
      </nav>

      <div className="relative flex min-h-dvh min-w-0 flex-1 flex-col">
        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col md:pb-0",
            // The runner pins itself to the viewport and pays its own
            // safe area.
            inRunner ? "pb-0" : "pb-[calc(92px+var(--safe-bottom))]",
          )}
        >
          <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col md:max-w-none">
            {children}
          </div>
        </main>

        {/* A floating bar: the whole column of each tab is the target the
            athlete hits mid-workout, not just the icon. */}
        {inRunner ? null : (
          <nav className="fixed inset-x-4 bottom-[calc(16px+var(--safe-bottom))] z-30 flex h-[68px] items-center rounded-3xl bg-chrome px-1.5 shadow-float md:hidden">
            {PRIMARY.map((item) => {
              const active = isActive(pathname, item);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className="flex h-full flex-1 flex-col items-center justify-center gap-1"
                >
                  <span
                    className={cn(
                      "flex h-[30px] w-[46px] items-center justify-center rounded-full",
                      active ? "bg-strength text-on-strength" : "text-ink",
                    )}
                  >
                    <Icon aria-hidden size={active ? 18 : 20} strokeWidth={2} />
                  </span>
                  <span
                    className={cn(
                      "text-[11px] leading-none",
                      active ? "font-bold text-clay" : "font-semibold text-mid",
                    )}
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}
