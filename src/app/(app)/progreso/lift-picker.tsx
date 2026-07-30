"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { cn } from "@/lib/cn";

export interface LiftOption {
  key: string;
  name: string;
}

/**
 * The lift selector. Flush cells, the gap is the rule.
 *
 * Navigation is a real URL change (`/progreso?lift=…`) so the server
 * recomputes the whole audit — the breakdown must never be a client guess.
 */
export function LiftPicker({
  lifts,
  active,
}: {
  lifts: LiftOption[];
  active: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    // Wraps rather than scrolls: a hidden scrollbar on a flush strip gives
    // no hint that there are more lifts past the edge.
    <div className="flex flex-none flex-wrap gap-px bg-line py-px">
      {lifts.map((lift) => {
        const isActive = lift.key === active;
        return (
          <button
            key={lift.key}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => {
              if (isActive) return;
              startTransition(() => {
                router.push(`/progreso?lift=${encodeURIComponent(lift.key)}`);
              });
            }}
            className={cn(
              "min-w-[74px] flex-1 px-3 py-3.5 text-center text-[10px] leading-none font-bold tracking-[0.06em] whitespace-nowrap uppercase",
              isActive ? "bg-ink text-paper" : "bg-paper text-mid",
              pending && !isActive && "opacity-55",
            )}
          >
            {lift.name}
          </button>
        );
      })}
    </div>
  );
}
