import { NextResponse } from "next/server";

import { loadAthlete } from "@/lib/data/athlete";
import { createClient, getUser } from "@/lib/supabase/server";
import {
  formatWeight,
  isDeloadWeek,
  isRangeFailure,
  setsForWeek,
  tonnage,
  type LiftState,
  type LoadMode,
} from "@/lib/engine";
import {
  parsePreviousLiftState,
  preSessionLiftState,
  replayEngine,
} from "@/lib/engine/replay";
import { doubleProgression } from "@/lib/engine/progression";
import { liftStateFrom, phaseEngineConfig } from "@/lib/domain/plan";
import { syncRequestSchema } from "@/lib/offline/sync-schema";
import type { SyncResponse, SyncSessionResult } from "@/lib/offline/queue";

export const dynamic = "force-dynamic";

function persistLift(lift: LiftState) {
  return {
    e1rm_kg: lift.e1rmKg,
    penalty: lift.penalty,
    fail_count: lift.failCount,
    hold: lift.hold,
    hold_at_kg: lift.holdAtKg,
  };
}

/**
 * The sync endpoint the write-ahead queue flushes to. A Route Handler,
 * not a server action: action IDs rotate on every deploy and a queue
 * that survived a week offline must still land.
 *
 * Everything in here is idempotent — set_logs upsert on their natural
 * key, engine events dedup on engine_events.dedup_key, statuses only
 * ever elevate — so a flush that died halfway is safe to repeat.
 */
export async function POST(request: Request) {
  const athlete = await loadAthlete();
  if (!athlete) {
    // Signed out and signed-in-without-an-active-program are different
    // problems: the syncer waits for a session refresh on 401, but a
    // 409 means the athlete must activate a programme first.
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "not_authenticated" } satisfies SyncResponse,
        { status: 401 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "no_active_program" } satisfies SyncResponse,
      { status: 409 },
    );
  }

  let parsed;
  try {
    parsed = syncRequestSchema.safeParse(await request.json());
  } catch {
    parsed = { success: false as const, error: null };
  }
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "bad_request" } satisfies SyncResponse,
      { status: 400 },
    );
  }

  const body = parsed.data;
  const { ctx, config } = athlete;
  const supabase = await createClient();
  const results: SyncSessionResult[] = [];
  const ackedKeys: string[] = [];
  const failures: NonNullable<SyncResponse["failures"]> = [];

  for (const env of body.sessions) {
    try {
      /* ── which programme does this envelope belong to? ────── */
      // The queue can hold a session logged under a programme that was
      // archived before the flush. It still gets written — under ITS
      // programme — but the engine only ever runs for the active one.
      let envelopeProgramId = ctx.program.id;
      let archived = false;
      if (env.key && !ctx.phases.some((p) => p.id === env.key!.phaseId)) {
        const { data: foreignPhase } = await supabase
          .from("program_phases")
          .select("id, program_id")
          .eq("id", env.key.phaseId)
          .maybeSingle();
        if (!foreignPhase?.program_id) {
          failures.push({
            opKeys: env.opKeys,
            reason: "la fase de la sesión ya no existe en ningún programa",
            transient: false,
          });
          continue;
        }
        envelopeProgramId = foreignPhase.program_id;
        archived = true;
      }

      /* ── resolve the session: natural key, then its own id ── */
      let session = null;
      if (env.key) {
        const { data } = await supabase
          .from("sessions")
          .select("id, status, started_at, phase_id, slot_id, week")
          .eq("user_id", athlete.userId)
          .eq("scheduled_on", env.key.scheduledOn)
          .eq("slot_id", env.key.slotId)
          .maybeSingle();
        session = data;
      }
      if (!session) {
        const { data } = await supabase
          .from("sessions")
          .select("id, status, started_at, phase_id, slot_id, week")
          .eq("user_id", athlete.userId)
          .eq("id", env.localSessionId)
          .maybeSingle();
        session = data;
      }

      if (!session && !env.key) {
        // No key to insert with and no row to attach to: retrying can
        // never fix this envelope, so say so instead of looping.
        failures.push({
          opKeys: env.opKeys,
          reason: "sesión desconocida: sin clave y sin fila en el servidor",
          transient: false,
        });
        continue;
      }

      if (!session && env.key) {
        const { data: inserted, error } = await supabase
          .from("sessions")
          .insert({
            id: env.localSessionId,
            user_id: athlete.userId,
            program_id: envelopeProgramId,
            phase_id: env.key.phaseId,
            slot_id: env.key.slotId,
            scheduled_on: env.key.scheduledOn,
            week: env.key.week,
            day_index: env.key.dayIndex,
            session_type: env.key.sessionType,
            title: env.key.title,
            status: "in_progress",
            started_at: env.startedAt,
          })
          .select("id, status, started_at, phase_id, slot_id, week")
          .single();
        if (error) throw new Error(error.message);
        session = inserted;
      } else if (
        session &&
        (session.status === "planned" || session.status === "skipped")
      ) {
        await supabase
          .from("sessions")
          .update({
            status: "in_progress",
            started_at: session.started_at ?? env.startedAt,
          })
          .eq("id", session.id);
      }
      if (!session) throw new Error("sesión sin resolver");
      const sessionId = session.id;

      // The slot's prescriptions — from ctx for the active programme,
      // from the DB for an archived one, so missed_range and the
      // partial/done grade stay honest either way. Only the ACTIVE
      // programme ever moves the engine.
      const phase =
        ctx.phases.find(
          (p) => p.id === (session.phase_id ?? env.key?.phaseId),
        ) ?? null;
      const phaseConfig = phase ? phaseEngineConfig(config, phase) : config;
      const envSlotId = session.slot_id ?? env.key?.slotId ?? null;
      let slotExercises = ctx.exercises.filter(
        (e) => e.slot_id === envSlotId,
      );
      if (archived && envSlotId) {
        const { data: archivedRows } = await supabase
          .from("program_exercises")
          .select("*")
          .eq("slot_id", envSlotId);
        slotExercises = archivedRows ?? [];
      }

      /* ── deletions first: an unmarked set stops existing ──── */
      // The replay below re-folds from whatever rows survive, and the
      // stale-event reverter cleans up any fail event whose source set
      // is gone — the engine needs no unlog concept of its own.
      if (env.unlogs.length) {
        for (const u of env.unlogs) {
          const { error } = await supabase.from("set_logs").delete().match({
            session_id: sessionId,
            position: u.position,
            set_index: u.setIndex,
          });
          if (error) throw new Error(error.message);
        }
      }

      /* ── upsert the sets, missed_range recomputed here ────── */
      if (env.sets.length) {
        const rows = env.sets.map((s) => {
          const exercise = slotExercises.find(
            (e) => e.id === s.programExerciseId,
          );
          const achieved = s.reps ?? s.seconds ?? 0;
          return {
            session_id: sessionId,
            user_id: athlete.userId,
            program_exercise_id: s.programExerciseId,
            lift_key: exercise?.lift_key ?? s.liftKey,
            exercise_name: exercise?.name ?? s.exerciseName,
            position: s.position,
            set_index: s.setIndex,
            reps: s.reps,
            seconds: s.seconds,
            rir: s.rir,
            weight_kg: s.weightKg,
            missed_range: exercise
              ? isRangeFailure(achieved, exercise.rep_min)
              : false,
            logged_at: s.loggedAt,
          };
        });
        let { error } = await supabase
          .from("set_logs")
          .upsert(rows, { onConflict: "session_id,position,set_index" });
        if (error?.code === "23503") {
          // A referenced exercise was deleted between logging and this
          // flush. The denormalised name/lift_key carry the history —
          // drop only the dead pointers instead of poisoning the
          // envelope forever.
          const ids = [...new Set(rows.map((r) => r.program_exercise_id))];
          const { data: alive } = await supabase
            .from("program_exercises")
            .select("id")
            .in("id", ids);
          const ok = new Set((alive ?? []).map((e) => e.id));
          ({ error } = await supabase.from("set_logs").upsert(
            rows.map((r) => ({
              ...r,
              program_exercise_id: ok.has(r.program_exercise_id)
                ? r.program_exercise_id
                : null,
            })),
            { onConflict: "session_id,position,set_index" },
          ));
        }
        if (error) throw new Error(error.message);
      }

      /* ── replay the engine against what the DB now holds ──── */
      const primaryRow = slotExercises.find((e) => e.is_primary && e.lift_key);
      const liftRow = primaryRow
        ? (ctx.lifts.find((l) => l.key === primaryRow.lift_key) ?? null)
        : null;

      const { data: dbLogs } = await supabase
        .from("set_logs")
        .select("program_exercise_id, position, set_index, reps, seconds, weight_kg")
        .eq("session_id", sessionId)
        .order("set_index");

      let banner: SyncSessionResult["banner"] = null;

      if (!archived && primaryRow && liftRow) {
        const { data: priorEvents } = await supabase
          .from("engine_events")
          .select("dedup_key, created_at, reverted_at, kind, payload")
          .eq("session_id", sessionId)
          .eq("lift_id", liftRow.id);

        const failEvents = (priorEvents ?? []).filter(
          (e) => e.kind === "fail_hold" || e.kind === "fail_penalty",
        );
        // Clean releases rewind too: without their `previous` snapshot,
        // unlogging the set that made a session clean could never bring
        // the released hold back. Rows written before the payload
        // existed parse to null and are simply skipped.
        const cleanEvents = (priorEvents ?? []).filter(
          (e) => e.kind === "clean_reset",
        );
        // A session with legacy events (no dedup_key) was driven by the
        // old per-set action path: its effects are already applied and
        // cannot be told apart. Leave the engine alone for it.
        const legacy = failEvents.some((e) => !e.dedup_key);

        if (!legacy) {
          const pre = preSessionLiftState(
            liftStateFrom(liftRow),
            [...failEvents, ...cleanEvents].map((e) => ({
              createdAt: e.created_at,
              previous: parsePreviousLiftState(
                (e.payload as { previous?: unknown } | null)?.previous,
              ),
            })),
          );

          // Failures the ATHLETE undid stay undone. A stale revert (the
          // system healing after an unlog/correction) is not an undo: if
          // the set comes back and misses again, the failure re-applies.
          const undone = [...env.undoneFailures];
          for (const e of failEvents) {
            if (!e.reverted_at || !e.dedup_key) continue;
            if (
              (e.payload as { stale_reverted?: unknown } | null)
                ?.stale_reverted
            ) {
              continue;
            }
            const m = e.dedup_key.match(/:fail:(\d+):(\d+)$/);
            if (m) undone.push({ position: +m[1], setIndex: +m[2] });
          }

          const replay = replayEngine({
            sessionId,
            lift: pre,
            primary: {
              programExerciseId: primaryRow.id,
              liftKey: primaryRow.lift_key!,
              repMin: primaryRow.rep_min,
              sets: setsForWeek(primaryRow.sets, session.week, phaseConfig),
            },
            logs: (dbLogs ?? []).map((l) => ({
              programExerciseId: l.program_exercise_id,
              position: l.position,
              setIndex: l.set_index,
              reps: l.reps,
              seconds: l.seconds,
              weightKg: l.weight_kg == null ? null : Number(l.weight_kg),
            })),
            undone,
            week: session.week,
            config: phaseConfig,
          });

          // A live failure whose stored event was stale-reverted earlier
          // (unlogged, then re-logged missing again) earns its event back.
          for (const ev of replay.events) {
            if (ev.undone) continue;
            const stored = failEvents.find((e) => e.dedup_key === ev.dedupKey);
            if (
              stored?.reverted_at &&
              (stored.payload as { stale_reverted?: unknown } | null)
                ?.stale_reverted
            ) {
              await supabase
                .from("engine_events")
                .update({
                  reverted_at: null,
                  payload: {
                    previous: { ...ev.previous },
                    missed_at_kg: ev.outcome.lift.holdAtKg,
                    source: ev.sourceSet,
                    forced_deload: ev.outcome.forcedDeload,
                  },
                })
                .eq("dedup_key", ev.dedupKey);
            }
          }

          for (const ev of replay.events) {
            const { error: eventError } = await supabase.from("engine_events").upsert(
              {
                dedup_key: ev.dedupKey,
                user_id: athlete.userId,
                program_id: ctx.program.id,
                lift_id: liftRow.id,
                session_id: sessionId,
                week: session.week,
                kind: ev.kind,
                title: ev.title,
                detail: ev.detail,
                // `previous` is the LiftState verbatim — the exact shape
                // parsePreviousLiftState/preSessionLiftState read back.
                payload: {
                  previous: { ...ev.previous },
                  missed_at_kg: ev.outcome.lift.holdAtKg,
                  source: ev.sourceSet,
                  forced_deload: ev.outcome.forcedDeload,
                },
                reverted_at: ev.undone ? new Date().toISOString() : null,
              },
              { onConflict: "dedup_key", ignoreDuplicates: true },
            );
            if (eventError) throw new Error(eventError.message);
          }
          // An undo arriving after the event already existed live.
          for (const u of env.undoneFailures) {
            await supabase
              .from("engine_events")
              .update({ reverted_at: new Date().toISOString() })
              .eq("dedup_key", `${sessionId}:fail:${u.position}:${u.setIndex}`)
              .is("reverted_at", null);
          }

          // A corrected set can erase a failure: a persisted fail event
          // whose source set no longer misses in this replay is stale —
          // revert it and let the lift row follow the fold, which now
          // starts (and ends) at the true pre-session state.
          const currentKeys = new Set(replay.events.map((e) => e.dedupKey));
          let staleReverted = 0;
          for (const e of failEvents) {
            if (!e.dedup_key || e.reverted_at) continue;
            if (currentKeys.has(e.dedup_key)) continue;
            // Flagged as a SYSTEM revert, not an athlete undo, so a
            // future flush can re-apply it if the miss comes back.
            await supabase
              .from("engine_events")
              .update({
                reverted_at: new Date().toISOString(),
                payload: {
                  ...((e.payload as Record<string, unknown> | null) ?? {}),
                  stale_reverted: true,
                },
              })
              .eq("dedup_key", e.dedup_key);
            staleReverted += 1;
          }

          // A clean release goes stale the same way a fail does: if this
          // replay no longer earns it (a set was unlogged, or corrected
          // below the range and then undone), the persisted clean_reset
          // is a lie — revert it and let the lift fold back to held.
          let cleanStaleReverted = 0;
          if (!replay.released) {
            for (const e of cleanEvents) {
              if (!e.dedup_key || e.reverted_at) continue;
              // A pre-payload release cannot rewind, so no replay can
              // ever re-earn it — leave that history alone.
              const rewindable = parsePreviousLiftState(
                (e.payload as { previous?: unknown } | null)?.previous,
              );
              if (!rewindable) continue;
              await supabase
                .from("engine_events")
                .update({ reverted_at: new Date().toISOString() })
                .eq("dedup_key", e.dedup_key);
              cleanStaleReverted += 1;
            }
          }

          const touched =
            replay.events.some((e) => !e.undone) ||
            env.undoneFailures.length > 0 ||
            staleReverted > 0 ||
            cleanStaleReverted > 0 ||
            replay.released;
          if (touched && replay.lift) {
            await supabase
              .from("lifts")
              .update(persistLift(replay.lift))
              .eq("id", liftRow.id);
          }

          if (replay.released) {
            const { error: cleanError } = await supabase
              .from("engine_events")
              .upsert(
                {
                  dedup_key: replay.cleanDedupKey,
                  user_id: athlete.userId,
                  program_id: ctx.program.id,
                  lift_id: liftRow.id,
                  session_id: sessionId,
                  week: session.week,
                  kind: "clean_reset",
                  title: `${liftRow.name} · sesión limpia`,
                  detail:
                    "Todas las series dentro del rango. El contador de fallos vuelve a cero y el peso deja de estar en espera.",
                  // The state the release acted on — what a later replay
                  // rewinds to if this session stops being clean.
                  payload: { previous: { ...pre } },
                },
                { onConflict: "dedup_key", ignoreDuplicates: true },
              );
            if (cleanError) throw new Error(cleanError.message);
            // Re-earned after a stale revert: the event is true again.
            await supabase
              .from("engine_events")
              .update({ reverted_at: null })
              .eq("dedup_key", replay.cleanDedupKey)
              .not("reverted_at", "is", null);
          }

          banner = replay.banner;
        }
      }

      /* ── finish ───────────────────────────────────────────── */
      let status = session.status;
      if (env.finish) {
        const alreadyClosed =
          session.status === "done" || session.status === "partial";
        const plannedSets = slotExercises.reduce(
          (acc, e) => acc + setsForWeek(e.sets, session.week, phaseConfig),
          0,
        );
        const doneSets = (dbLogs ?? []).length;
        status = plannedSets > 0 && doneSets < plannedSets ? "partial" : "done";

        const startedMs = session.started_at ?? env.startedAt;
        const duration =
          startedMs != null
            ? Math.max(
                0,
                Math.round(
                  (new Date(env.finish.finishedAt).getTime() -
                    new Date(startedMs).getTime()) /
                    1000,
                ),
              )
            : null;

        const { data: fullLogs } = await supabase
          .from("set_logs")
          .select("program_exercise_id, reps, seconds, rir, weight_kg")
          .eq("session_id", sessionId);

        const { error } = await supabase
          .from("sessions")
          .update({
            status,
            // A correction re-grades sets and totals, not time: the
            // original completed_at and duration stand.
            ...(alreadyClosed
              ? {}
              : {
                  completed_at: env.finish.finishedAt,
                  duration_seconds: duration,
                }),
            tonnage_kg: tonnage(
              (fullLogs ?? []).map((l) => ({
                weightKg: l.weight_kg == null ? null : Number(l.weight_kg),
                reps: l.reps,
              })),
            ),
            ...(env.finish.notes ? { notes: env.finish.notes } : {}),
          })
          .eq("id", sessionId);
        if (error) throw new Error(error.message);

        // Double progression for accessories — deduped per exercise so
        // a repeated flush can never award the jump twice. Never on the
        // deload (topping a halved-volume session proves nothing) and
        // never for an archived programme. Corrections re-grade: a bump
        // whose sets were unlogged or corrected down is taken back, and
        // an upward correction can still earn one.
        if (!archived && !isDeloadWeek(session.week, phaseConfig)) {
          const { data: bumpRows } = await supabase
            .from("engine_events")
            .select("dedup_key, reverted_at, payload")
            .eq("session_id", sessionId)
            .eq("kind", "accessory_bump");
          const bumpByExercise = new Map(
            (bumpRows ?? []).map((b) => [
              String(
                (b.payload as { program_exercise_id?: unknown } | null)
                  ?.program_exercise_id ?? "",
              ),
              b,
            ]),
          );

          for (const e of slotExercises) {
            if (e.is_primary) continue;
            if (e.load_mode !== "fixed" && e.load_mode !== "weighted_bodyweight") {
              continue;
            }
            const existing = bumpByExercise.get(e.id) ?? null;
            const rows = (fullLogs ?? []).filter(
              (l) => l.program_exercise_id === e.id,
            );
            const outcome = doubleProgression(
              {
                equipment: e.equipment,
                effort: e.effort as "reps" | "seconds" | "amrap",
                loadMode: e.load_mode as LoadMode,
                repMax: e.rep_max,
                plannedSets: setsForWeek(e.sets, session.week, phaseConfig),
                currentWeightKg:
                  e.fixed_weight_kg == null ? null : Number(e.fixed_weight_kg),
                logs: rows.map((l) => ({
                  reps: l.reps,
                  seconds: l.seconds,
                  rir: l.rir == null ? null : Number(l.rir),
                })),
              },
              phaseConfig,
            );

            if (!outcome.advance || outcome.nextWeightKg == null) {
              // The sets no longer earn the jump this session awarded:
              // take the weight back and strike the event through.
              if (existing && !existing.reverted_at && existing.dedup_key) {
                const previousKg = (
                  existing.payload as { previous_kg?: unknown } | null
                )?.previous_kg;
                await supabase
                  .from("engine_events")
                  .update({ reverted_at: new Date().toISOString() })
                  .eq("dedup_key", existing.dedup_key);
                if (previousKg != null) {
                  await supabase
                    .from("program_exercises")
                    .update({ fixed_weight_kg: Number(previousKg) })
                    .eq("id", e.id);
                }
              }
              continue;
            }

            if (existing?.reverted_at && existing.dedup_key) {
              // Re-earned after a correction took it back.
              await supabase
                .from("engine_events")
                .update({ reverted_at: null })
                .eq("dedup_key", existing.dedup_key);
              await supabase
                .from("program_exercises")
                .update({ fixed_weight_kg: outcome.nextWeightKg })
                .eq("id", e.id);
              continue;
            }
            if (existing) continue; // already awarded and still earned

            const { data: bumpRow, error: bumpError } = await supabase
              .from("engine_events")
              .upsert(
                {
                  dedup_key: `${sessionId}:bump:${e.id}`,
                  user_id: athlete.userId,
                  program_id: ctx.program.id,
                  session_id: sessionId,
                  week: session.week,
                  kind: "accessory_bump",
                  title: `${e.name} · sube a ${formatWeight(outcome.nextWeightKg)} kg`,
                  detail: `Todas las series al tope del rango. La próxima sesión: ${formatWeight(outcome.nextWeightKg)} kg.`,
                  payload: {
                    program_exercise_id: e.id,
                    previous_kg: e.fixed_weight_kg,
                    next_kg: outcome.nextWeightKg,
                    reason: outcome.reason,
                  },
                },
                { onConflict: "dedup_key", ignoreDuplicates: true },
              )
              .select("id");
            if (bumpError) throw new Error(bumpError.message);
            // Conflict → this bump was already awarded by an earlier flush.
            if (bumpRow && bumpRow.length > 0) {
              await supabase
                .from("program_exercises")
                .update({ fixed_weight_kg: outcome.nextWeightKg })
                .eq("id", e.id);
            }
          }
        }
      }

      results.push({
        localSessionId: env.localSessionId,
        canonicalSessionId: sessionId,
        setsApplied: env.sets.length,
        status,
        banner,
        ...(archived ? { engineSkipped: true } : {}),
      });
      ackedKeys.push(...env.opKeys);
    } catch (cause) {
      // This envelope stays queued; the others still land — but never
      // silently: the log is the only way a stuck queue gets diagnosed.
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error("[sync] session envelope failed", {
        localSessionId: env.localSessionId,
        message,
      });
      failures.push({ opKeys: env.opKeys, reason: message, transient: true });
    }
  }

  /* ── run logs ────────────────────────────────────────────── */
  for (const r of body.runLogs) {
    try {
      // Same archived-programme attribution as the session envelopes.
      let runProgramId = ctx.program.id;
      if (!ctx.phases.some((p) => p.id === r.key.phaseId)) {
        const { data: foreignPhase } = await supabase
          .from("program_phases")
          .select("program_id")
          .eq("id", r.key.phaseId)
          .maybeSingle();
        if (!foreignPhase?.program_id) {
          failures.push({
            opKeys: [r.opKey],
            reason: "la fase de la carrera ya no existe en ningún programa",
            transient: false,
          });
          continue;
        }
        runProgramId = foreignPhase.program_id;
      }

      const { data: session, error } = await supabase
        .from("sessions")
        .upsert(
          {
            user_id: athlete.userId,
            program_id: runProgramId,
            phase_id: r.key.phaseId,
            slot_id: r.key.slotId,
            scheduled_on: r.key.scheduledOn,
            week: r.key.week,
            day_index: r.key.dayIndex,
            session_type: r.key.sessionType,
            title: r.key.title,
            status: "done",
            completed_at: new Date().toISOString(),
            duration_seconds: r.durationMinutes
              ? Math.round(r.durationMinutes * 60)
              : null,
          },
          { onConflict: "user_id,scheduled_on,slot_id" },
        )
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      const { error: logError } = await supabase.from("run_logs").upsert(
        {
          session_id: session.id,
          user_id: athlete.userId,
          prescription: r.prescription,
          duration_seconds: r.durationMinutes
            ? Math.round(r.durationMinutes * 60)
            : null,
          distance_km: r.distanceKm,
          avg_hr: r.avgHr,
          decoupling_pct: r.decouplingPct,
          perceived_effort: r.perceivedEffort ?? null,
          notes: r.notes,
        },
        { onConflict: "session_id" },
      );
      if (logError) throw new Error(logError.message);
      ackedKeys.push(r.opKey);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error("[sync] run log failed", { opKey: r.opKey, message });
      failures.push({ opKeys: [r.opKey], reason: message, transient: true });
    }
  }

  /* ── mobility logs ───────────────────────────────────────── */
  for (const m of body.mobilityLogs) {
    try {
      const { error } = await supabase.from("mobility_logs").upsert(
        {
          user_id: athlete.userId,
          performed_on: m.performedOn,
          completed_slugs: m.completedSlugs,
          total_items: m.totalItems,
        },
        { onConflict: "user_id,performed_on" },
      );
      if (error) throw new Error(error.message);
      ackedKeys.push(m.opKey);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error("[sync] mobility log failed", { opKey: m.opKey, message });
      failures.push({ opKeys: [m.opKey], reason: message, transient: true });
    }
  }

  return NextResponse.json({
    ok: true,
    results,
    ackedKeys,
    failures,
  } satisfies SyncResponse);
}
