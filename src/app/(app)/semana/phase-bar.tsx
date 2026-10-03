"use client";

import Link from "next/link";
import { useState } from "react";

import { cn } from "@/lib/cn";

export interface PhaseInfo {
  id: string;
  key: string;
  name: string;
  emphasis: string;
  notes: string;
  priority: string;
  weeks: number;
  /** "sep – dic" style range, null when the phase has no dates yet. */
  rangeLabel: string | null;
  /** "28 sep": the caption under its segment, short enough for 4 weeks of 36. */
  startsLabel: string | null;
  firstAbsoluteWeek: number;
  current: boolean;
}

/**
 * The season bar, tappable: each phase opens its own card — what it is
 * for (emphasis), how it runs (notes), what to keep when a week breaks
 * (priority), and a chip per week so any week of the season is two taps
 * away instead of n presses of the stepper.
 */
export function PhaseBar({
  phases,
  activeAbsoluteWeek,
}: {
  phases: PhaseInfo[];
  /** The absolute week the screen is currently showing. */
  activeAbsoluteWeek: number;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = phases.find((p) => p.id === openId) ?? null;
  const currentIndex = phases.findIndex((p) => p.current);

  return (
    <>
      <div className="flex gap-1">
        {phases.map((p, i) => (
          <button
            key={p.id}
            type="button"
            // Proportional, but never so thin a 4-week phase loses its label.
            style={{ flex: `${p.weeks} 1 0%`, minWidth: 56 }}
            aria-expanded={openId === p.id}
            onClick={() => setOpenId(openId === p.id ? null : p.id)}
            className="flex min-w-0 flex-col gap-1.5"
          >
            <span
              className={cn(
                "num flex h-9 w-full items-center justify-center rounded-[10px] px-1 text-[12px] leading-none",
                p.current
                  ? "bg-strength font-extrabold text-on-strength"
                  : i < currentIndex
                    ? "bg-quiet font-bold text-mid"
                    : "bg-soft font-bold text-body",
                openId === p.id &&
                  !p.current &&
                  "shadow-[inset_0_0_0_2px_var(--clay-line)]",
              )}
            >
              <span className="truncate">
                {p.key}
              </span>
            </span>
            <span
              className={cn(
                "w-full truncate text-center text-[11px] leading-none",
                p.current ? "font-bold text-clay" : "font-semibold text-mid",
              )}
            >
              {i < currentIndex ? `${p.weeks} sem` : (p.startsLabel ?? p.name)}
            </span>
          </button>
        ))}
      </div>

      {open ? (
        <div className="mt-3 rounded-lg bg-soft px-3.5 py-3">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[14px] leading-[1.2] font-bold">
              {open.name}
            </span>
            <span className="flex-none text-[12px] leading-none font-semibold text-mid">
              <span className="num">{open.weeks}</span> semanas
            </span>
          </div>
          {open.rangeLabel ? (
            <div className="num mt-1 text-[12px] leading-none font-medium text-mid">
              {open.rangeLabel}
            </div>
          ) : null}
          {open.emphasis ? (
            <p className="mt-2 text-[12.5px] leading-[1.45] font-medium">
              {open.emphasis}
            </p>
          ) : null}
          {open.notes ? (
            <p className="mt-1.5 text-[12px] leading-[1.5] text-mid">
              {open.notes}
            </p>
          ) : null}
          {open.priority ? (
            <p className="mt-1.5 text-[12px] leading-[1.5] text-mid">
              <span className="font-bold text-ink">Si falta un día: </span>
              {open.priority}
            </p>
          ) : null}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {Array.from({ length: open.weeks }, (_, i) => {
              const absolute = open.firstAbsoluteWeek + i;
              const active = absolute === activeAbsoluteWeek;
              return (
                <Link
                  key={absolute}
                  href={`/semana?semana=${absolute}`}
                  aria-label={`Semana ${i + 1} de ${open.key}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "num flex h-8 w-8 items-center justify-center rounded-full text-[12px] leading-none font-bold",
                    active
                      ? "bg-strength text-on-strength"
                      : "bg-surface text-mid",
                  )}
                >
                  {i + 1}
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
