"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { ActionBar } from "@/components/ui/kit";
import { setSessionStatus, startSession } from "@/lib/actions/session";
import type { SessionGroup, SessionStatus, SessionType } from "@/lib/domain/plan";

export interface DayTarget {
  phaseId: string;
  slotId: string;
  scheduledOn: string;
  week: number;
  dayIndex: number;
  sessionType: SessionType;
  title: string;
  group: SessionGroup;
}

export function StartSessionButton({
  day,
  existingSessionId,
  existingStatus,
  groupLabel,
}: {
  day: DayTarget;
  existingSessionId: string | null;
  existingStatus: SessionStatus | null;
  groupLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (day.group === "rest") {
    return (
      <div className="flex h-16 flex-none items-center justify-center bg-soft text-[13px] leading-none font-bold tracking-[0.1em] text-mid uppercase">
        Día libre
      </div>
    );
  }

  if (existingStatus === "done" || existingStatus === "partial") {
    return (
      <div className="flex h-16 flex-none items-center justify-center gap-3 bg-ink text-[15px] leading-none font-extrabold tracking-[0.1em] text-ok-bright uppercase">
        ✓ Registrada
      </div>
    );
  }

  const label = pending ? "…" : existingSessionId ? "SEGUIR SESIÓN" : groupLabel;

  return (
    <ActionBar
      tone={day.group === "run" ? "run" : "strength"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (day.group === "mobility") {
            router.push("/movilidad");
            return;
          }
          if (day.group === "run") {
            router.push(`/carrera/${day.scheduledOn}`);
            return;
          }
          const res = await startSession({
            phaseId: day.phaseId,
            slotId: day.slotId,
            scheduledOn: day.scheduledOn,
            week: day.week,
            dayIndex: day.dayIndex,
            sessionType: day.sessionType,
            title: day.title,
          });
          if (res.ok && res.sessionId) router.push(`/sesion/${res.sessionId}`);
        })
      }
    >
      {label}
      <span className="font-medium">→</span>
    </ActionBar>
  );
}

/** Quick "skip" used from the week list. */
export function SkipDayButton({ day }: { day: DayTarget }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setSessionStatus({
            phaseId: day.phaseId,
            slotId: day.slotId,
            scheduledOn: day.scheduledOn,
            week: day.week,
            dayIndex: day.dayIndex,
            sessionType: day.sessionType,
            title: day.title,
            status: "skipped",
          });
        })
      }
      className="text-[10px] leading-none font-semibold tracking-[0.08em] text-mid underline uppercase"
    >
      {pending ? "…" : "Saltar"}
    </button>
  );
}
