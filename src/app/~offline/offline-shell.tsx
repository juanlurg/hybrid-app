"use client";

import { useEffect, useState } from "react";

import { LocalSessionRunner } from "@/components/session/local-session-runner";
import {
  daysBetween,
  formatDayLong,
  placeDate,
  todayIso,
} from "@/lib/domain/calendar";
import {
  phaseSpans,
  resolveDay,
  type ResolvedDay,
} from "@/lib/domain/plan";
import { createLocalSession } from "@/lib/offline/local-session";
import { openOfflineStore } from "@/lib/offline/db";
import type { QueueOp } from "@/lib/offline/queue";
import {
  SNAPSHOT_KEY,
  validateSnapshot,
  type AthleteSnapshot,
} from "@/lib/offline/snapshot";
import {
  allLocalSessions,
  attachSyncTriggers,
  deleteLocalSession,
  enqueueOp,
  putLocalSession,
} from "@/lib/offline/syncer";

type ShellState =
  | { phase: "loading" }
  | { phase: "empty" }
  | {
      phase: "ready";
      snapshot: AthleteSnapshot;
      today: ResolvedDay | null;
      activeSessionId: string | null;
      /** Today's run already sits in the queue — marked on this device. */
      runQueued: boolean;
      stale: boolean;
    };

/**
 * What the athlete sees in a basement gym: today's session resolved
 * from the snapshot, and the runner over the local queue. Nothing here
 * touches the network; the syncer flushes when it returns.
 */
export function OfflineShell() {
  const [state, setState] = useState<ShellState>({ phase: "loading" });
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runMarked, setRunMarked] = useState(false);

  useEffect(() => {
    attachSyncTriggers();
    void (async () => {
      try {
        const store = openOfflineStore();
        const snapshot = validateSnapshot(
          await store.get("snapshot", SNAPSHOT_KEY),
        );
        if (!snapshot) {
          setState({ phase: "empty" });
          return;
        }
        const { ctx, config } = snapshot;
        const placement = placeDate(phaseSpans(ctx.phases), todayIso());
        const phase = placement
          ? (ctx.phases.find((p) => p.id === placement.phase.id) ?? null)
          : null;
        const today =
          placement && phase
            ? resolveDay(
                {
                  ctx,
                  config,
                  phase,
                  week: placement.week,
                  absoluteWeek: placement.absoluteWeek,
                },
                placement.dayIndex,
              )
            : null;

        // Resume only a session from today (±1 day for a workout that
        // crossed midnight) — an abandoned one from weeks ago must not
        // shadow today's start button forever. Anything older is pruned,
        // but NEVER while its ops still sit in the queue: the local
        // session holds the key the flush hydrates envelopes with.
        const todayDate = todayIso();
        const sessions = await allLocalSessions();
        const queued = await store.getAll<{ op: QueueOp }>("queue");
        const withQueuedOps = new Set(
          queued
            .map((r) =>
              "localSessionId" in r.value.op
                ? r.value.op.localSessionId
                : undefined,
            )
            .filter((id): id is string => Boolean(id)),
        );
        const runQueued = queued.some(
          (r) =>
            r.value.op.kind === "run_log" &&
            r.value.op.key.scheduledOn === todayDate &&
            r.value.op.key.slotId === today?.slot?.id,
        );
        for (const s of sessions) {
          if (
            s.status === "in_progress" &&
            !withQueuedOps.has(s.localSessionId) &&
            daysBetween(s.key.scheduledOn, todayDate) > 2
          ) {
            await deleteLocalSession(s.localSessionId);
          }
        }
        const active =
          sessions
            .filter(
              (s) =>
                s.status === "in_progress" &&
                Math.abs(daysBetween(s.key.scheduledOn, todayDate)) <= 1,
            )
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;

        setState({
          phase: "ready",
          snapshot,
          today,
          activeSessionId: active?.localSessionId ?? null,
          runQueued,
          stale:
            Date.now() - new Date(snapshot.savedAt).getTime() >
            24 * 3600 * 1000,
        });
      } catch {
        setState({ phase: "empty" });
      }
    })();
  }, []);

  if (runningId) {
    return <LocalSessionRunner sessionId={runningId} />;
  }

  if (state.phase === "loading") {
    return <Frame note="Cargando los datos guardados…" />;
  }
  if (state.phase === "empty") {
    return (
      <Frame note="Este dispositivo no tiene datos guardados todavía. Abre la app con conexión al menos una vez y el plan queda disponible sin red." />
    );
  }

  const { snapshot, today, activeSessionId, runQueued, stale } = state;

  async function startToday() {
    if (!today?.slot) return;
    const localId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const key = {
      phaseId: today.phaseId,
      slotId: today.slot.id,
      scheduledOn: today.date,
      week: today.week,
      dayIndex: today.dayIndex,
      sessionType: today.sessionType,
      title: today.title,
    };
    await putLocalSession(createLocalSession(localId, key, startedAt));
    await enqueueOp({
      kind: "session_start",
      localSessionId: localId,
      key,
      startedAt,
    });
    setRunningId(localId);
  }

  /**
   * One tap, same op the Carrera form sends: the run lands in the queue
   * and /api/sync upserts it when the network returns. The watch data can
   * be added later from /carrera — same key, same upsert, idempotent.
   */
  async function markRunDone() {
    if (!today?.slot) return;
    await enqueueOp({
      kind: "run_log",
      key: {
        phaseId: today.phaseId,
        slotId: today.slot.id,
        scheduledOn: today.date,
        week: today.week,
        dayIndex: today.dayIndex,
        sessionType: today.sessionType,
        title: today.title,
      },
      prescription: today.prescription,
      durationMinutes: null,
      distanceKm: null,
      avgHr: null,
      decouplingPct: null,
      perceivedEffort: null,
      notes: "",
      loggedAt: new Date().toISOString(),
    });
    setRunMarked(true);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="bg-ink px-4 pt-5 pb-4 text-paper">
        <div className="text-[11px] leading-none font-extrabold tracking-[0.14em] uppercase opacity-70">
          Sin conexión
        </div>
        <h1 className="mt-2 text-[26px] leading-[1.02] font-black tracking-[-0.03em]">
          {today ? today.title : "Bloques"}
        </h1>
        <p className="num mt-2 text-[11px] leading-none opacity-60">
          {today ? formatDayLong(today.date) : ""}
          {stale
            ? ` · plan guardado el ${formatDayLong(snapshot.savedAt.slice(0, 10))}`
            : ""}
        </p>
      </header>

      <div className="flex-1 overflow-auto">
        {today && today.group === "strength" && today.exercises.length > 0 ? (
          <div className="mt-2.5 flex flex-col gap-px bg-line">
            {today.exercises.map((e) => (
              <div
                key={e.id}
                className="flex items-baseline gap-2.5 bg-paper px-4 py-2.5"
              >
                <span className="flex-1 text-[13px] leading-[1.2] font-semibold">
                  {e.name}
                </span>
                <span className="num text-[11px] leading-none text-mid">
                  {e.schemeLabel}
                </span>
                <span className="num min-w-[62px] text-right text-[12.5px] leading-none font-extrabold">
                  {e.weightLabel}
                </span>
              </div>
            ))}
          </div>
        ) : today && today.group === "run" && today.slot ? (
          <div className="px-4 py-5">
            <p className="text-[13.5px] leading-[1.3] font-bold">
              {today.prescription || today.title}
            </p>
            <p className="mt-2 text-[12px] leading-[1.5] text-mid">
              Sal y corre: el detalle queda en el reloj. Márcala hecha aquí y
              se sube al volver la red; los datos del reloj se añaden después
              desde Carrera.
            </p>
          </div>
        ) : (
          <p className="px-4 py-5 text-[12px] leading-[1.5] text-mid">
            {today
              ? "Hoy no toca fuerza. La movilidad se marca desde su pantalla al volver la red."
              : "Hoy queda fuera del plan guardado."}
          </p>
        )}

        <p className="px-4 py-4 text-[11px] leading-[1.5] text-faint">
          Todo lo que registres aquí queda en este móvil y se sube solo al
          recuperar la cobertura.
        </p>
      </div>

      {activeSessionId ? (
        <button
          type="button"
          onClick={() => setRunningId(activeSessionId)}
          className="flex h-16 flex-none items-center justify-center gap-2.5 bg-strength text-[16px] leading-none font-extrabold tracking-[0.1em] text-ink uppercase"
        >
          Seguir sesión <span className="font-medium">→</span>
        </button>
      ) : today && today.group === "strength" && today.exercises.length > 0 ? (
        <button
          type="button"
          onClick={() => void startToday()}
          className="flex h-16 flex-none items-center justify-center gap-2.5 bg-strength text-[16px] leading-none font-extrabold tracking-[0.1em] text-ink uppercase"
        >
          Empezar sin conexión <span className="font-medium">→</span>
        </button>
      ) : today && today.group === "run" && today.slot ? (
        runMarked || runQueued ? (
          <div className="flex h-16 flex-none items-center justify-center gap-3 bg-ink text-[15px] leading-none font-extrabold tracking-[0.1em] text-ok-bright uppercase">
            ✓ Registrada · se sube con red
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void markRunDone()}
            className="flex h-16 flex-none items-center justify-center gap-2.5 bg-run text-[16px] leading-none font-extrabold tracking-[0.1em] text-paper uppercase"
          >
            Marcar hecha <span className="font-medium">✓</span>
          </button>
        )
      ) : null}
    </div>
  );
}

function Frame({ note }: { note: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="bg-ink px-4 pt-5 pb-4 text-paper">
        <div className="text-[11px] leading-none font-extrabold tracking-[0.14em] uppercase opacity-70">
          Sin conexión
        </div>
      </header>
      <p className="px-4 py-6 text-[12px] leading-[1.5] text-mid">{note}</p>
    </div>
  );
}
