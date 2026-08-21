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

  return (
    <>
      <div className="mt-2.5 flex gap-1 px-5">
        {phases.map((p) => (
          <button
            key={p.id}
            type="button"
            style={{ flex: p.weeks }}
            aria-expanded={openId === p.id}
            onClick={() => setOpenId(openId === p.id ? null : p.id)}
            className={cn(
              "font-display flex h-[34px] min-w-0 items-center justify-center rounded-sm px-1 text-[11px] leading-none uppercase",
              p.current
                ? "bg-strength font-bold text-on-strength"
                : "border border-line bg-surface font-semibold text-faint",
              openId === p.id && !p.current && "border-lime-line text-mid",
            )}
          >
            <span className="truncate">{p.key}</span>
          </button>
        ))}
      </div>

      {open ? (
        <div className="mx-5 mt-2 rounded-xl border border-line bg-sunk px-3.5 py-3">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[13.5px] leading-[1.2] font-semibold">
              {open.name}
            </span>
            <span className="font-display flex-none text-[10px] leading-none font-semibold tracking-[0.1em] text-faint uppercase">
              {open.key} · <span className="num">{open.weeks}</span> sem
            </span>
          </div>
          {open.rangeLabel ? (
            <div className="num mt-1 text-[11.5px] leading-none text-faint">
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
              <span className="font-display text-[10px] font-semibold tracking-[0.1em] text-faint uppercase">
                si falta un día ·{" "}
              </span>
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
                    "num flex h-8 w-8 items-center justify-center rounded-sm border text-[12px] leading-none font-semibold",
                    active
                      ? "border-transparent bg-strength text-on-strength"
                      : "border-edge bg-surface text-mid",
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
