"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { cn } from "@/lib/cn";

/**
 * The − / value / + stepper next to the header eyebrow. Navigation moves
 * the *absolute* season week through the URL, but the well counts weeks
 * inside the phase — the same number the title and the engine speak. The
 * absolute coordinate lives on the season strip below.
 *
 * Navigation is a URL change so the server re-resolves the plan for that
 * week — no client-side plan maths, ever.
 */
export function WeekNav({
  absoluteWeek,
  seasonWeeks,
  week,
  phaseWeeks,
}: {
  absoluteWeek: number;
  seasonWeeks: number;
  week: number;
  phaseWeeks: number;
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
    "flex h-8 w-8 flex-none items-center justify-center rounded-sm border border-edge bg-surface text-[15px] leading-none text-mid disabled:opacity-35";

  return (
    <div
      className={cn("flex flex-none items-center gap-1", pending && "opacity-60")}
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
        className="num flex h-8 flex-none items-center justify-center rounded-sm border border-edge bg-surface px-2.5 text-[12px] leading-none font-semibold"
      >
        <span className="sr-only">Semana de la fase </span>
        {week}/{phaseWeeks}
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
