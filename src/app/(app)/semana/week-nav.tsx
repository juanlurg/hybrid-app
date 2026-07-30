"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { cn } from "@/lib/cn";

/**
 * The − / value / + stepper in the black header. It moves the *absolute*
 * season week, so the well spells that coordinate out — the eyebrow next
 * to it counts weeks inside the phase, which is a different number.
 *
 * Navigation is a URL change so the server re-resolves the plan for that
 * week — no client-side plan maths, ever.
 */
export function WeekNav({
  absoluteWeek,
  seasonWeeks,
}: {
  absoluteWeek: number;
  seasonWeeks: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const last = Math.max(1, seasonWeeks);
  const go = (next: number) => {
    const target = Math.min(Math.max(1, next), last);
    if (target === absoluteWeek) return;
    startTransition(() => {
      router.push(`/semana?semana=${target}`);
    });
  };

  const square =
    "flex h-[38px] w-[38px] flex-none items-center justify-center bg-ink-2 text-[18px] leading-none font-bold text-paper disabled:opacity-35";

  return (
    <div
      className={cn(
        "flex flex-none items-center gap-px self-start",
        pending && "opacity-60",
      )}
    >
      <button
        type="button"
        aria-label="Semana anterior"
        disabled={absoluteWeek <= 1}
        onClick={() => go(absoluteWeek - 1)}
        className={square}
      >
        −
      </button>
      <div
        aria-live="polite"
        className="num flex h-[38px] min-w-[52px] flex-none items-center justify-center bg-ink-2 px-2 text-[12.5px] leading-none font-extrabold text-paper"
      >
        <span className="sr-only">Semana de temporada </span>
        {absoluteWeek}/{last}
      </div>
      <button
        type="button"
        aria-label="Semana siguiente"
        disabled={absoluteWeek >= last}
        onClick={() => go(absoluteWeek + 1)}
        className={square}
      >
        +
      </button>
    </div>
  );
}
