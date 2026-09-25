"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { cn } from "@/lib/cn";

/**
 * ‹ / › beside the header, plus a way home when you have wandered off.
 * The title already says which week this is, so the control does not
 * repeat a number — two numbers side by side read as two different weeks.
 *
 * Navigation is a URL change so the server re-resolves the plan for that
 * week — no client-side plan maths, ever.
 */
export function WeekNav({
  absoluteWeek,
  seasonWeeks,
  currentWeek,
}: {
  absoluteWeek: number;
  seasonWeeks: number;
  /** The absolute week today falls in. */
  currentWeek: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const last = Math.max(1, seasonWeeks);
  const go = (next: number) => {
    const target = Math.min(Math.max(1, next), last);
    if (target === absoluteWeek) return;
    startTransition(() => {
      router.push(target === currentWeek ? "/semana" : `/semana?semana=${target}`);
    });
  };

  const square =
    "flex h-10 w-10 flex-none items-center justify-center rounded-sm border border-edge bg-surface text-[18px] leading-none text-mid disabled:opacity-35";

  return (
    <div
      className={cn("flex flex-none items-center gap-1", pending && "opacity-60")}
    >
      {absoluteWeek !== currentWeek ? (
        <button
          type="button"
          onClick={() => go(currentWeek)}
          className="font-display flex h-10 flex-none items-center rounded-sm border border-edge bg-surface px-3 text-[12px] leading-none font-semibold tracking-[0.08em] text-lime uppercase"
        >
          Hoy
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Semana anterior"
        disabled={absoluteWeek <= 1}
        onClick={() => go(absoluteWeek - 1)}
        className={square}
      >
        ‹
      </button>
      <button
        type="button"
        aria-label="Semana siguiente"
        disabled={absoluteWeek >= last}
        onClick={() => go(absoluteWeek + 1)}
        className={square}
      >
        ›
      </button>
    </div>
  );
}
