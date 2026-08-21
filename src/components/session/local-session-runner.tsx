"use client";

import { useEffect, useState } from "react";

import { SessionRunner } from "@/components/session/session-runner";
import {
  Footnote,
  Row,
  RowStack,
  ScreenHeader,
  StatGrid,
} from "@/components/ui/kit";
import {
  liftStateFrom,
  phaseEngineConfig,
  resolveDay,
  type ResolvedExercise,
} from "@/lib/domain/plan";
import { summarise, type ExerciseSummary } from "@/lib/domain/summary";
import { formatTonnage, setsForWeek, tonnage } from "@/lib/engine";
import type { LocalSessionState } from "@/lib/offline/local-session";
import { openOfflineStore } from "@/lib/offline/db";
import { SNAPSHOT_KEY, validateSnapshot, type AthleteSnapshot } from "@/lib/offline/snapshot";
import { getLocalSession, pendingOps } from "@/lib/offline/syncer";
import { cn } from "@/lib/cn";

type LoadState =
  | { phase: "loading" }
  | { phase: "missing" }
  | { phase: "ready"; snapshot: AthleteSnapshot; local: LocalSessionState };

/**
 * Mounts the normal SessionRunner from what IndexedDB holds — no server
 * involved. This is how a session opened offline (or resumed after the
 * tab died in a basement gym) keeps running.
 */
export function LocalSessionRunner({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });

  useEffect(() => {
    void (async () => {
      try {
        const store = openOfflineStore();
        const [snapRaw, local] = await Promise.all([
          store.get("snapshot", SNAPSHOT_KEY),
          getLocalSession(sessionId),
        ]);
        const snapshot = validateSnapshot(snapRaw);
        if (!snapshot || !local) {
          setState({ phase: "missing" });
          return;
        }
        setState({ phase: "ready", snapshot, local });
      } catch {
        setState({ phase: "missing" });
      }
    })();
  }, [sessionId]);

  if (state.phase === "loading") {
    return <ShellNote text="Cargando la sesión guardada en este dispositivo…" />;
  }
  if (state.phase === "missing") {
    return (
      <ShellNote text="No hay ninguna sesión guardada en este dispositivo con ese identificador. Vuelve con conexión y entra desde Hoy." />
    );
  }

  const { snapshot, local } = state;
  const { ctx, config } = snapshot;
  const phase = ctx.phases.find((p) => p.id === local.key.phaseId);
  if (!phase) {
    return <ShellNote text="El plan guardado ya no contiene esta fase. Abre la app con conexión." />;
  }

  const day = resolveDay(
    {
      ctx,
      config,
      phase,
      week: local.key.week,
      absoluteWeek: local.key.week,
    },
    local.key.dayIndex,
  );
  if (day.exercises.length === 0) {
    return <ShellNote text="Este día no tiene ejercicios de fuerza en el plan guardado." />;
  }

  if (local.status === "done" || local.status === "partial") {
    return <LocalSummary local={local} exercises={day.exercises} />;
  }

  const phaseConfig = phaseEngineConfig(config, phase);
  const primaryRow = ctx.exercises.find(
    (e) => e.id === day.primary?.id && e.is_primary,
  );
  const liftRow = primaryRow?.lift_key
    ? (ctx.lifts.find((l) => l.key === primaryRow.lift_key) ?? null)
    : null;

  const initialLogs = Object.entries(local.logs).flatMap(([k, entry]) => {
    const [pos, idx] = k.split(":").map(Number);
    const ex = day.exercises.find((e) => e.position === pos);
    if (!ex) return [];
    return [
      {
        programExerciseId: ex.id,
        setIndex: idx,
        reps: entry.timed ? null : entry.value,
        seconds: entry.timed ? entry.value : null,
        weightKg: entry.weightKg,
        rir: entry.rir,
        missedRange: entry.missed,
      },
    ];
  });

  return (
    <SessionRunner
      sessionId={sessionId}
      sessionKey={local.key}
      label={`${day.label} · sin conexión`}
      exercises={day.exercises}
      initialLogs={initialLogs}
      initialUndone={local.undoneFailures}
      replayCtx={{
        // The snapshot is the last online render — if it was taken
        // mid-session after a flush, the fold may start one step late.
        // The server replay is the truth either way.
        lift: liftRow ? liftStateFrom(liftRow) : null,
        primary:
          primaryRow && primaryRow.lift_key
            ? {
                programExerciseId: primaryRow.id,
                liftKey: primaryRow.lift_key,
                repMin: primaryRow.rep_min,
                sets: setsForWeek(primaryRow.sets, local.key.week, phaseConfig),
              }
            : null,
        week: local.key.week,
        config: phaseConfig,
      }}
      autoRest={ctx.profile.auto_rest_timer}
      sound={ctx.profile.rest_sound}
      vibration={ctx.profile.rest_vibration}
      keepAwake={ctx.profile.keep_screen_awake}
      showPlates={ctx.profile.show_plate_breakdown}
      targetRir={ctx.profile.target_rir}
    />
  );
}

/** The offline stand-in for the resumen: honest numbers, no invention. */
function LocalSummary({
  local,
  exercises,
}: {
  local: LocalSessionState;
  exercises: ResolvedExercise[];
}) {
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => {
    void pendingOps().then(setPending);
  }, []);

  const rowsFor = (ex: ResolvedExercise) =>
    Object.entries(local.logs)
      .filter(([k]) => Number(k.split(":")[0]) === ex.position)
      .map(([, e]) => ({
        reps: e.timed ? null : e.value,
        seconds: e.timed ? e.value : null,
        weight_kg: e.weightKg,
        missed_range: e.missed,
      }));

  const summaries: ExerciseSummary[] = exercises.map((ex) =>
    summarise(ex.id, ex.name, ex.isPrimary, ex.sets, ex.loadMode, rowsFor(ex)),
  );
  const doneSets = summaries.reduce((acc, s) => acc + s.doneSets, 0);
  const totalKg = tonnage(
    Object.values(local.logs).map((e) => ({
      weightKg: e.weightKg,
      reps: e.timed ? 0 : e.value,
    })),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <ScreenHeader
        eyebrow={`${local.status === "done" ? "Sesión completa" : "Sesión parcial"} · sin conexión`}
        title="Guardada en este móvil"
        subtitle={
          pending
            ? `${pending} apunte(s) pendientes de subir. Se sincronizan solos al volver la red.`
            : "Todo sincronizado."
        }
      />

      <StatGrid
        items={[
          { value: doneSets, label: "Series" },
          { value: formatTonnage(totalKg), label: "Tonelaje" },
        ]}
      />

      <RowStack className="mt-1.5">
        {summaries.map((s) => (
          <Row key={s.key} className="flex items-baseline gap-2.5">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[14px] leading-[1.2] font-semibold",
                s.doneSets === 0 && "text-faint",
              )}
            >
              {s.name}
            </span>
            <span className="num text-[11.5px] leading-none text-mid">
              {s.doneSets}/{s.plannedSets ?? "—"}
            </span>
            <span className="num min-w-[62px] text-right text-[13px] leading-none font-semibold">
              {s.weightLabel}
            </span>
          </Row>
        ))}
      </RowStack>

      <Footnote>
        El resumen completo, con lo que diga el motor, aparece al abrir la
        sesión con conexión.
      </Footnote>
    </div>
  );
}

function ShellNote({ text }: { text: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader eyebrow="Sin conexión" />
      <p className="px-5 pt-4 text-[13px] leading-[1.5] text-mid">{text}</p>
    </div>
  );
}
