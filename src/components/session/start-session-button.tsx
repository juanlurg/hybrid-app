"use client";

import Link from "next/link";
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
      <div className="flex-none px-5 pt-3.5 pb-3">
        <div className="font-display flex h-15 w-full items-center justify-center rounded-xl border border-edge bg-soft text-[13px] leading-none font-semibold tracking-[0.1em] text-mid uppercase">
          Día libre
        </div>
      </div>
    );
  }

  if (existingStatus === "done" || existingStatus === "partial") {
    // The registered pill opens the record: the strength resumen, or the
    // day screen that owns runs and mobility.
    const recordHref =
      day.group === "strength"
        ? existingSessionId
          ? `/sesion/${existingSessionId}/resumen`
          : null
        : day.group === "run"
          ? `/carrera/${day.scheduledOn}`
          : day.group === "mobility"
            ? "/movilidad"
            : null;
    const pill =
      "font-display flex h-15 w-full items-center justify-center gap-3 rounded-xl border border-lime-edge bg-lime-soft text-[15px] leading-none font-bold tracking-[0.06em] text-lime uppercase";
    return (
      <div className="flex-none px-5 pt-3.5 pb-3">
        {recordHref ? (
          <Link href={recordHref} className={pill}>
            ✓ Registrada · ver
          </Link>
        ) : (
          <div className={pill}>✓ Registrada</div>
        )}
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
      className="font-display text-[10.5px] leading-none font-semibold tracking-[0.08em] text-mid underline uppercase"
    >
      {pending ? "…" : "Saltar"}
    </button>
  );
}
