"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
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
    "flex h-11 w-11 flex-none items-center justify-center rounded-full bg-surface text-ink shadow-raised disabled:opacity-35";

  return (
    <div
      className={cn(
        "mt-0.5 flex flex-none items-center gap-2",
        pending && "opacity-60",
      )}
    >
      {absoluteWeek !== currentWeek ? (
        <button
          type="button"
          onClick={() => go(currentWeek)}
          className="flex h-11 flex-none items-center rounded-full bg-surface px-3.5 text-[13px] leading-none font-bold text-clay shadow-raised"
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
        <ChevronLeft aria-hidden size={18} />
      </button>
      <button
        type="button"
        aria-label="Semana siguiente"
        disabled={absoluteWeek >= last}
        onClick={() => go(absoluteWeek + 1)}
        className={square}
      >
        <ChevronRight aria-hidden size={18} />
      </button>
    </div>
  );
}
