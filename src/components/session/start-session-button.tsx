"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { ActionBar } from "@/components/ui/kit";
import { setSessionStatus } from "@/lib/actions/session";
import { createLocalSession } from "@/lib/offline/local-session";
import { enqueueOp, flush, putLocalSession } from "@/lib/offline/syncer";
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
          // Local-first: the session exists on this device before any
          // network happens; the flush lands it (and may hand back the
          // canonical id if another device already opened it).
          const localId = crypto.randomUUID();
          const startedAt = new Date().toISOString();
          const key = {
            phaseId: day.phaseId,
            slotId: day.slotId,
            scheduledOn: day.scheduledOn,
            week: day.week,
            dayIndex: day.dayIndex,
            sessionType: day.sessionType,
            title: day.title,
          };
          await putLocalSession(createLocalSession(localId, key, startedAt));
          await enqueueOp({
            kind: "session_start",
            localSessionId: localId,
            key,
            startedAt,
          });
          const res = await flush();
          const canonical =
            res?.results?.find((r) => r.localSessionId === localId)
              ?.canonicalSessionId ??
            existingSessionId ??
            localId;
          router.push(`/sesion/${canonical}`);
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
      className="flex h-10 flex-none items-center border-2 border-ink px-3 text-[10px] leading-none font-bold tracking-[0.08em] uppercase disabled:opacity-40"
    >
      {pending ? "…" : "Saltar"}
    </button>
  );
}
