"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Chip } from "@/components/ui/kit";
import { cn } from "@/lib/cn";

export interface LiftOption {
  key: string;
  name: string;
}

/**
 * The lift selector — a wrapping row of pills.
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
    // Wraps rather than scrolls: a hidden scrollbar gives no hint that there
    // are more lifts past the edge.
    <div className="flex flex-none flex-wrap gap-1.5 px-5 pt-3.5">
      {lifts.map((lift) => {
        const isActive = lift.key === active;
        return (
          <Chip
            key={lift.key}
            active={isActive}
            aria-current={isActive ? "page" : undefined}
            onClick={() => {
              if (isActive) return;
              startTransition(() => {
                router.push(`/progreso?lift=${encodeURIComponent(lift.key)}`);
              });
            }}
            className={cn(
              "flex min-h-11 items-center rounded-full px-3 text-[11.5px] whitespace-nowrap uppercase",
              isActive ? "font-bold" : "bg-surface text-mid",
              pending && !isActive && "opacity-55",
            )}
          >
            {lift.name}
          </Chip>
        );
      })}
    </div>
  );
}
