import { NextResponse } from "next/server";
import { z } from "zod";

import { loadAthlete } from "@/lib/data/athlete";
import { createClient } from "@/lib/supabase/server";
import {
  formatWeight,
  isRangeFailure,
  setsForWeek,
  tonnage,
  type LiftState,
} from "@/lib/engine";
import { preSessionLiftState, replayEngine } from "@/lib/engine/replay";
import { doubleProgression } from "@/lib/engine/progression";
import { liftStateFrom, phaseEngineConfig } from "@/lib/domain/plan";
import type { SyncResponse, SyncSessionResult } from "@/lib/offline/queue";

export const dynamic = "force-dynamic";

/* ── request schema ──────────────────────────────────────────── */

const sessionKeySchema = z.object({
  phaseId: z.string().uuid(),
  slotId: z.string().uuid(),
  scheduledOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  week: z.number().int().min(1).max(60),
  dayIndex: z.number().int().min(0).max(6),
  sessionType: z.enum([
    "strength", "run_quality", "run_long", "run_easy", "run_test",
    "mobility", "rest",
  ]),
  title: z.string().max(200),
});

const setSchema = z.object({
  programExerciseId: z.string().uuid(),
  liftKey: z.string().max(60).nullable(),
  exerciseName: z.string().max(200),
  position: z.number().int().min(0).max(50),
  setIndex: z.number().int().min(0).max(30),
  reps: z.number().int().min(0).max(200).nullable(),
  seconds: z.number().int().min(0).max(600).nullable(),
  rir: z.number().min(0).max(10).nullable(),
  weightKg: z.number().min(0).max(1000).nullable(),
  loggedAt: z.string(),
});

const sessionEnvelopeSchema = z.object({
  localSessionId: z.string().uuid(),
  key: sessionKeySchema,
  startedAt: z.string().nullable(),
  sets: z.array(setSchema).max(200),
  undoneFailures: z
    .array(z.object({ position: z.number().int(), setIndex: z.number().int() }))
    .max(50),
  finish: z.object({ finishedAt: z.string() }).nullable(),
  opKeys: z.array(z.string().max(200)).max(300),
});

const syncRequestSchema = z.object({
  protocolVersion: z.literal(1),
  deviceId: z.string().max(100),
  sessions: z.array(sessionEnvelopeSchema).max(30),
  runLogs: z
    .array(
      z.object({
        key: sessionKeySchema,
        prescription: z.string().max(400),
        durationMinutes: z.number().min(0).max(1000).nullable(),
        distanceKm: z.number().min(0).max(500).nullable(),
        avgHr: z.number().int().min(0).max(250).nullable(),
        decouplingPct: z.number().min(-50).max(50).nullable(),
        notes: z.string().max(2000),
        opKey: z.string().max(200),
      }),
    )
    .max(60),
  mobilityLogs: z
    .array(
      z.object({
        performedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        completedSlugs: z.array(z.string().max(100)).max(60),
        totalItems: z.number().int().min(0).max(100),
        opKey: z.string().max(200),
      }),
    )
    .max(60),
});

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
    return NextResponse.json(
      { ok: false, error: "not_authenticated" } satisfies SyncResponse,
      { status: 401 },
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

  for (const env of body.sessions) {
    try {
      /* ── resolve the session by its natural key ───────────── */
      const { data: existing } = await supabase
        .from("sessions")
        .select("id, status, started_at, phase_id, slot_id, week")
        .eq("user_id", athlete.userId)
        .eq("scheduled_on", env.key.scheduledOn)
        .eq("slot_id", env.key.slotId)
        .maybeSingle();

      let session = existing;
      if (!session) {
        const { data: inserted, error } = await supabase
          .from("sessions")
          .insert({
            id: env.localSessionId,
            user_id: athlete.userId,
            program_id: ctx.program.id,
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
      } else if (session.status === "planned" || session.status === "skipped") {
        await supabase
          .from("sessions")
          .update({
            status: "in_progress",
            started_at: session.started_at ?? env.startedAt,
          })
          .eq("id", session.id);
      }
      const sessionId = session.id;

      /* ── upsert the sets, missed_range recomputed here ────── */
      if (env.sets.length) {
        const rows = env.sets.map((s) => {
          const exercise = ctx.exercises.find(
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
        const { error } = await supabase
          .from("set_logs")
          .upsert(rows, { onConflict: "session_id,position,set_index" });
        if (error) throw new Error(error.message);
      }

      /* ── replay the engine against what the DB now holds ──── */
      const phase =
        ctx.phases.find((p) => p.id === (session.phase_id ?? env.key.phaseId)) ??
        null;
      const phaseConfig = phase ? phaseEngineConfig(config, phase) : config;
      const slotExercises = ctx.exercises.filter(
        (e) => e.slot_id === (session.slot_id ?? env.key.slotId),
      );
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

      if (primaryRow && liftRow) {
        const { data: priorEvents } = await supabase
          .from("engine_events")
          .select("dedup_key, created_at, reverted_at, kind, payload")
          .eq("session_id", sessionId)
          .eq("lift_id", liftRow.id);

        const failEvents = (priorEvents ?? []).filter(
          (e) => e.kind === "fail_hold" || e.kind === "fail_penalty",
        );
        // A session with legacy events (no dedup_key) was driven by the
        // old per-set action path: its effects are already applied and
        // cannot be told apart. Leave the engine alone for it.
        const legacy = failEvents.some((e) => !e.dedup_key);

        if (!legacy) {
          const pre = preSessionLiftState(
            liftStateFrom(liftRow),
            failEvents.map((e) => ({
              createdAt: e.created_at,
              previous:
                ((e.payload as { previous?: Record<string, unknown> } | null)
                  ?.previous as Partial<LiftState> | null) ?? null,
            })),
          );

          // Failures undone now or in any earlier flush stay undone.
          const undone = [...env.undoneFailures];
          for (const e of failEvents) {
            if (!e.reverted_at || !e.dedup_key) continue;
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

          for (const ev of replay.events) {
            await supabase.from("engine_events").upsert(
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
                payload: {
                  previous: persistLift(ev.previous),
                  missed_at_kg: ev.outcome.lift.holdAtKg,
                  source: ev.sourceSet,
                  forced_deload: ev.outcome.forcedDeload,
                },
                reverted_at: ev.undone ? new Date().toISOString() : null,
              },
              { onConflict: "dedup_key", ignoreDuplicates: true },
            );
          }
          // An undo arriving after the event already existed live.
          for (const u of env.undoneFailures) {
            await supabase
              .from("engine_events")
              .update({ reverted_at: new Date().toISOString() })
              .eq("dedup_key", `${sessionId}:fail:${u.position}:${u.setIndex}`)
              .is("reverted_at", null);
          }

          const touched =
            replay.events.some((e) => !e.undone) ||
            env.undoneFailures.length > 0 ||
            (replay.clean && (pre.hold || pre.failCount > 0));
          if (touched && replay.lift) {
            await supabase
              .from("lifts")
              .update(persistLift(replay.lift))
              .eq("id", liftRow.id);
          }

          if (replay.clean && (pre.hold || pre.failCount > 0)) {
            await supabase.from("engine_events").upsert(
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
              },
              { onConflict: "dedup_key", ignoreDuplicates: true },
            );
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
            completed_at: env.finish.finishedAt,
            duration_seconds: duration,
            tonnage_kg: tonnage(
              (fullLogs ?? []).map((l) => ({
                weightKg: l.weight_kg == null ? null : Number(l.weight_kg),
                reps: l.reps,
              })),
            ),
          })
          .eq("id", sessionId);
        if (error) throw new Error(error.message);

        // Double progression for accessories — deduped per exercise so
        // a repeated flush can never award the jump twice.
        if (!alreadyClosed) {
          for (const e of slotExercises) {
            if (e.is_primary) continue;
            if (e.load_mode !== "fixed" && e.load_mode !== "weighted_bodyweight") {
              continue;
            }
            const rows = (fullLogs ?? []).filter(
              (l) => l.program_exercise_id === e.id,
            );
            const outcome = doubleProgression(
              {
                equipment: e.equipment,
                effort: e.effort as "reps" | "seconds" | "amrap",
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
            if (!outcome.advance || outcome.nextWeightKg == null) continue;

            const { data: bumpRow } = await supabase
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
      });
      ackedKeys.push(...env.opKeys);
    } catch {
      // This envelope stays queued; the others still land.
    }
  }

  /* ── run logs ────────────────────────────────────────────── */
  for (const r of body.runLogs) {
    try {
      const { data: session, error } = await supabase
        .from("sessions")
        .upsert(
          {
            user_id: athlete.userId,
            program_id: ctx.program.id,
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
          notes: r.notes,
        },
        { onConflict: "session_id" },
      );
      if (logError) throw new Error(logError.message);
      ackedKeys.push(r.opKey);
    } catch {
      // Stays queued.
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
    } catch {
      // Stays queued.
    }
  }

  return NextResponse.json({
    ok: true,
    results,
    ackedKeys,
  } satisfies SyncResponse);
}
