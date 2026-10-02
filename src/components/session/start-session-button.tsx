"use client";

import { Check, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ActionBar } from "@/components/ui/kit";
import { cn } from "@/lib/cn";
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
  className,
}: {
  day: DayTarget;
  existingSessionId: string | null;
  existingStatus: SessionStatus | null;
  groupLabel: string;
  /** Applied to the wrapper, so a screen can sit it beside another button. */
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (day.group === "rest") {
    return (
      <div className={cn("flex-none px-4 pt-3.5 pb-3", className)}>
        <div className="flex h-14 w-full items-center justify-center rounded-xl bg-quiet text-[15px] leading-none font-bold text-mid">
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
      "flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-ok-soft text-[15px] leading-none font-bold text-ok";
    return (
      <div className={cn("flex-none px-4 pt-3.5 pb-3", className)}>
        {recordHref ? (
          <Link href={recordHref} className={pill}>
            <Check aria-hidden size={18} strokeWidth={2.5} />
            Registrada · ver
          </Link>
        ) : (
          <div className={pill}>
            <Check aria-hidden size={18} strokeWidth={2.5} />
            Registrada
          </div>
        )}
      </div>
    );
  }

  const label = pending ? "…" : existingSessionId ? "Seguir sesión" : groupLabel;
  const Icon = day.group === "strength" ? Play : Check;

  return (
    <ActionBar
      className={className}
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
      <Icon
        aria-hidden
        size={day.group === "strength" ? 16 : 18}
        strokeWidth={2.5}
        fill={day.group === "strength" ? "currentColor" : "none"}
      />
      {label}
    </ActionBar>
  );
}

/**
 * "Hoy no entreno" is a decision, not an omission: a deliberate skip
 * closes the day as SALTADA instead of leaving it pending. Lives on the
 * day's own screen, one quiet line above the action — never on a list
 * row, where it sat next to the tap that opens the day.
 */
export function SkipDayButton({
  day,
  label = "Saltar este día",
  pill,
}: {
  day: DayTarget;
  label?: string;
  /** Drawn as the white button beside the start action. */
  pill?: boolean;
}) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div
        className={cn(
          "flex items-center gap-4",
          pill
            ? "h-14 flex-none rounded-xl bg-surface px-4 shadow-raised"
            : "px-5 py-2",
        )}
      >
        <span className="text-[13px] leading-none font-semibold text-mid">
          {pill ? "¿Saltar?" : `¿Saltar ${day.title}?`}
        </span>
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
              setConfirming(false);
            })
          }
          className="py-2 text-[14px] leading-none font-bold text-fail"
        >
          {pending ? "…" : "Sí"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="py-2 text-[14px] leading-none font-bold text-mid"
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className={
        pill
          ? "h-14 flex-none rounded-xl bg-surface px-4 text-[14px] leading-none font-bold text-ink shadow-raised"
          : "px-5 py-2 text-[13px] leading-none font-semibold text-mid underline underline-offset-4"
      }
    >
      {label}
    </button>
  );
}
