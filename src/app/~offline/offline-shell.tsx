"use client";

import { useEffect, useState } from "react";

import { LocalSessionRunner } from "@/components/session/local-session-runner";
import {
  ActionBar,
  Footnote,
  Row,
  RowStack,
  ScreenHeader,
} from "@/components/ui/kit";
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
        const queued = await store.getAll<{
          op: { localSessionId?: string };
        }>("queue");
        const withQueuedOps = new Set(
          queued
            .map((r) => r.value.op.localSessionId)
            .filter((id): id is string => Boolean(id)),
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

  const { snapshot, today, activeSessionId, stale } = state;

  async function startToday() {
    if (!today?.slot) return;
    const localId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    // Out of season, placeDate clamps and `today.date` is a plan date in
    // the future (or past): the session still happened on the real day,
    // so that is the date it is filed under. The plan day stays unmarked.
    const realToday = todayIso();
    const key = {
      phaseId: today.phaseId,
      slotId: today.slot.id,
      scheduledOn: today.date === realToday ? today.date : realToday,
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        eyebrow="sin conexión"
        title={today ? today.title : "Bloques"}
        subtitle={
          <span className="num">
            {today ? formatDayLong(today.date) : ""}
            {stale
              ? ` · plan guardado el ${formatDayLong(snapshot.savedAt.slice(0, 10))}`
              : ""}
          </span>
        }
      />

      <div className="flex-1 overflow-auto">
        {today && today.group === "strength" && today.exercises.length > 0 ? (
          <RowStack className="mt-4">
            {today.exercises.map((e) => (
              <Row key={e.id} className="flex items-baseline gap-2.5">
                <span className="flex-1 text-[14px] leading-[1.2] font-medium">
                  {e.name}
                </span>
                <span className="num text-[12px] leading-none text-mid">
                  {e.schemeLabel}
                </span>
                <span className="num min-w-[62px] text-right text-[14px] leading-none font-semibold">
                  {e.weightLabel}
                </span>
              </Row>
            ))}
          </RowStack>
        ) : (
          <p className="px-5 py-5 text-[12.5px] leading-[1.5] text-mid">
            {today
              ? "Hoy no toca fuerza. Las carreras y la movilidad se marcan desde sus pantallas al volver la red — o sal y corre: el detalle queda en el reloj."
              : "Hoy queda fuera del plan guardado."}
          </p>
        )}

        <Footnote>
          Todo lo que registres aquí queda en este móvil y se sube solo al
          recuperar la cobertura.
        </Footnote>
      </div>

      {activeSessionId ? (
        <ActionBar onClick={() => setRunningId(activeSessionId)}>
          Seguir sesión <span className="font-medium">→</span>
        </ActionBar>
      ) : today && today.group === "strength" && today.exercises.length > 0 ? (
        <ActionBar onClick={() => void startToday()}>
          Empezar sin conexión <span className="font-medium">→</span>
        </ActionBar>
      ) : null}
    </div>
  );
}

function Frame({ note }: { note: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader eyebrow="sin conexión" />
      <p className="px-5 py-6 text-[12.5px] leading-[1.5] text-mid">{note}</p>
    </div>
  );
}
