import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { buildCatalogContext, buildSeasonContext } from "@/lib/ai/prompt";
import { filterOwnedChanges, loadCatalog } from "@/lib/ai/proposal";
import { changeOpSchema } from "@/lib/ai/schema";
import { loadAthleteFor, type LoadedAthlete } from "@/lib/data/athlete";
import {
  addDays,
  DAY_LABELS,
  dayIndexOf,
  daysBetween,
  placeDate,
  type IsoDate,
} from "@/lib/domain/calendar";
import { phaseSpans } from "@/lib/domain/plan";
import type { Json } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * The tools `/api/mcp` serves to a Claude chat. Reads are the athlete's
 * whole season and history; the one write is a PENDING proposal — the
 * same `ai_proposals` row the in-app coach makes, ticked and applied by
 * the athlete in Editor, so `applyProposal`'s rules and undo still own
 * every change to the plan.
 *
 * Service-role client, so every query names its athlete explicitly.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** A failure the model should read and act on, not a crash. */
export class ToolError extends Error {}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  input: z.ZodType;
  readOnly: boolean;
  run: (args: never, db: Admin) => Promise<string>;
}

function tool<S extends z.ZodType>(def: {
  name: string;
  title: string;
  description: string;
  input: S;
  readOnly: boolean;
  run: (args: z.infer<S>, db: Admin) => Promise<string>;
}): McpTool {
  return def as McpTool;
}

const athleteArg = z
  .string()
  .min(1)
  .describe("Nombre del atleta (o su id), tal como lo da list_athletes.");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha YYYY-MM-DD");

/** Longest window get_sessions serves — keeps set_logs under PostgREST's row cap. */
const MAX_SESSION_DAYS = 62;

async function resolveAthlete(db: Admin, ref: string): Promise<LoadedAthlete> {
  const { data, error } = await db
    .from("profiles")
    .select("id, display_name")
    .not("onboarded_at", "is", null);
  if (error) throw new Error(error.message);
  const needle = ref.trim().toLowerCase();
  const matches = (data ?? []).filter(
    (p) => p.id === ref || p.display_name.trim().toLowerCase() === needle,
  );
  if (matches.length > 1) {
    throw new ToolError(`Hay varios atletas "${ref}": usa su id de list_athletes.`);
  }
  const row = matches[0];
  if (!row) {
    throw new ToolError(`No hay ningún atleta "${ref}". Usa list_athletes.`);
  }
  const athlete = await loadAthleteFor(db, { id: row.id, email: null });
  if (!athlete) {
    throw new ToolError(`${row.display_name} no tiene un programa activo.`);
  }
  return athlete;
}

const json = (value: unknown) => JSON.stringify(value);

/** Drop null/undefined/"" so the payload carries only what was logged. */
function compact<T extends Record<string, unknown>>(row: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(row).filter(([, v]) => v != null && v !== ""),
  ) as Partial<T>;
}

export const MCP_TOOLS: McpTool[] = [
  tool({
    name: "list_athletes",
    title: "Atletas",
    description:
      "Los atletas con programa activo: nombre, programa, carrera objetivo y dónde caen hoy (fase y semana).",
    input: z.object({}),
    readOnly: true,
    run: async (_args, db) => {
      const { data, error } = await db
        .from("profiles")
        .select("id, display_name")
        .not("onboarded_at", "is", null)
        .order("display_name");
      if (error) throw new Error(error.message);
      const rows = await Promise.all(
        (data ?? []).map(async (p) => {
          const a = await loadAthleteFor(db, { id: p.id, email: null });
          if (!a) return null;
          return compact({
            name: p.display_name,
            id: p.id,
            program: a.ctx.program.name,
            goal: a.ctx.program.goal,
            race: a.ctx.program.race_on
              ? `${a.ctx.program.race_name ?? "carrera"} el ${a.ctx.program.race_on}`
              : null,
            today: a.today,
            phase: `${a.placement.phase.key} — ${a.placement.phase.name}`,
            week: `${a.placement.week} de ${a.placement.phase.weeks} (temporada ${a.placement.absoluteWeek}/${a.seasonWeeks})`,
          });
        }),
      );
      return json(rows.filter(Boolean));
    },
  }),

  tool({
    name: "get_plan",
    title: "Plan de la temporada",
    description:
      "La temporada entera de un atleta: estado del motor de pesos (RM, kilos de esta semana, topes), y por cada fase sus sesiones tipo con ejercicios, la carrera semana a semana con sus bloques tipados, y la semana tipo. Incluye los ids (slotId, exerciseId, phaseKey) que necesita propose_changes.",
    input: z.object({ athlete: athleteArg }),
    readOnly: true,
    run: async ({ athlete }, db) =>
      buildSeasonContext(await resolveAthlete(db, athlete)),
  }),

  tool({
    name: "get_catalog",
    title: "Catálogo de ejercicios",
    description:
      "Los ejercicios que el atleta puede hacer con su material. Para añadir o sustituir un ejercicio usa SIEMPRE uno de estos slugs.",
    input: z.object({ athlete: athleteArg }),
    readOnly: true,
    run: async ({ athlete }, db) => {
      const a = await resolveAthlete(db, athlete);
      const catalog = await loadCatalog(
        db,
        a.userId,
        (a.ctx.profile.available_equipment ?? []).map(String),
      );
      return buildCatalogContext(
        [...catalog.values()].map((c) => ({
          slug: c.slug,
          name: c.name,
          equipment: String(c.equipment),
          pattern: c.pattern,
        })),
      );
    },
  }),

  tool({
    name: "get_sessions",
    title: "Sesiones: plan frente a hecho",
    description:
      `Día a día entre dos fechas: qué tocaba según el plan y qué se hizo — series (kg, reps, RIR, segundos, si quedó por debajo del rango), carreras (duración, distancia, pulso, desacople, RPE, notas), movilidad, eventos del motor (subidas, regresiones, descargas) y mediciones. Por defecto, las 4 últimas semanas; como mucho ${MAX_SESSION_DAYS} días por llamada.`,
    input: z.object({
      athlete: athleteArg,
      from: isoDate.optional().describe("Primer día, YYYY-MM-DD."),
      to: isoDate.optional().describe("Último día, YYYY-MM-DD. Por defecto hoy."),
    }),
    readOnly: true,
    run: async ({ athlete, from, to }, db) => {
      const a = await resolveAthlete(db, athlete);
      const last: IsoDate = to ?? a.today;
      const first: IsoDate = from ?? addDays(last, -27);
      const span = daysBetween(first, last);
      if (span < 0) throw new ToolError("from va después de to.");
      if (span >= MAX_SESSION_DAYS) {
        throw new ToolError(
          `Como mucho ${MAX_SESSION_DAYS} días por llamada: parte el rango.`,
        );
      }

      const [sessionsRes, mobilityRes, eventsRes, measurementsRes] =
        await Promise.all([
          db
            .from("sessions")
            .select("*")
            .eq("user_id", a.userId)
            .gte("scheduled_on", first)
            .lte("scheduled_on", last)
            .order("scheduled_on"),
          db
            .from("mobility_logs")
            .select("performed_on, completed_slugs, total_items, notes")
            .eq("user_id", a.userId)
            .gte("performed_on", first)
            .lte("performed_on", last),
          db
            .from("engine_events")
            .select("created_at, kind, title, detail, reverted_at")
            .eq("user_id", a.userId)
            .gte("created_at", first)
            .lt("created_at", addDays(last, 1))
            .order("created_at"),
          db
            .from("measurements")
            .select("taken_on, kind, label, value, unit, notes")
            .eq("user_id", a.userId)
            .gte("taken_on", first)
            .lte("taken_on", last)
            .order("taken_on"),
        ]);
      for (const res of [sessionsRes, mobilityRes, eventsRes, measurementsRes]) {
        if (res.error) throw new Error(res.error.message);
      }
      const sessions = sessionsRes.data ?? [];
      const ids = sessions.map((s) => s.id);
      const [setsRes, runsRes] = ids.length
        ? await Promise.all([
            db
              .from("set_logs")
              .select("*")
              .in("session_id", ids)
              .order("position")
              .order("set_index"),
            db.from("run_logs").select("*").in("session_id", ids),
          ])
        : [{ data: [], error: null }, { data: [], error: null }];
      if (setsRes.error) throw new Error(setsRes.error.message);
      if (runsRes.error) throw new Error(runsRes.error.message);

      const sessionView = (s: (typeof sessions)[number]) => {
        // One entry per exercise, in runner order; sets keep their order.
        const exercises = new Map<number, { name: string; lift?: string; sets: unknown[] }>();
        for (const l of (setsRes.data ?? []).filter((l) => l.session_id === s.id)) {
          if (!exercises.has(l.position)) {
            exercises.set(l.position, {
              name: l.exercise_name,
              ...(l.lift_key ? { lift: l.lift_key } : {}),
              sets: [],
            });
          }
          exercises.get(l.position)!.sets.push(
            compact({
              kg: l.weight_kg,
              reps: l.reps,
              rir: l.rir,
              sec: l.seconds,
              missed: l.missed_range || null,
            }),
          );
        }
        const run = (runsRes.data ?? []).find((r) => r.session_id === s.id);
        return compact({
          title: s.title,
          type: s.session_type,
          status: s.status,
          startedAt: s.started_at,
          completedAt: s.completed_at,
          minutes: s.duration_seconds == null ? null : Math.round(s.duration_seconds / 60),
          tonnageKg: Number(s.tonnage_kg) || null,
          notes: s.notes,
          exercises: exercises.size ? [...exercises.values()] : null,
          run: run
            ? compact({
                prescription: run.prescription,
                minutes: run.duration_seconds == null ? null : Math.round(run.duration_seconds / 60),
                km: run.distance_km,
                avgHr: run.avg_hr,
                maxHr: run.max_hr,
                decouplingPct: run.decoupling_pct,
                zone: run.dominant_zone,
                rpe: run.perceived_effort,
                notes: run.notes,
              })
            : null,
        });
      };

      const spans = phaseSpans(a.ctx.phases);
      const days = [];
      for (let date = first; date <= last; date = addDays(date, 1)) {
        // placeDate clamps outside the season; only an exact hit is a plan day.
        const hit = placeDate(spans, date);
        const placed = hit?.date === date ? hit : null;
        const slotId = placed
          ? a.ctx.days.find(
              (d) => d.phase_id === placed.phase.id && d.day_index === placed.dayIndex,
            )?.slot_id
          : undefined;
        const slot = a.ctx.slots.find((s) => s.id === slotId);
        const run = placed
          ? a.ctx.prescriptions.find(
              (r) =>
                r.phase_id === placed.phase.id &&
                r.slot_id === slotId &&
                r.week === placed.week,
            )
          : undefined;
        const mobility = (mobilityRes.data ?? []).find((m) => m.performed_on === date);
        days.push(
          compact({
            date,
            day: DAY_LABELS[dayIndexOf(date)],
            plan: placed
              ? `${placed.phase.key} sem ${placed.week} · ${slot ? `${slot.title} (${slot.session_type})` : "—"}${run ? ` · ${run.prescription}` : ""}`
              : "fuera de temporada",
            done: sessions.filter((s) => s.scheduled_on === date).map(sessionView),
            mobility: mobility
              ? compact({
                  done: `${mobility.completed_slugs.length}/${mobility.total_items}`,
                  notes: mobility.notes,
                })
              : null,
          }),
        );
      }

      return json({
        athlete: a.ctx.profile.display_name,
        from: first,
        to: last,
        today: a.today,
        days,
        engineEvents: (eventsRes.data ?? []).map((e) =>
          compact({
            at: e.created_at.slice(0, 10),
            kind: e.kind,
            title: e.title,
            detail: e.detail,
            reverted: e.reverted_at ? true : null,
          }),
        ),
        measurements: (measurementsRes.data ?? []).map((m) => compact(m)),
      });
    },
  }),

  tool({
    name: "get_proposals",
    title: "Propuestas anteriores",
    description:
      "Las últimas propuestas de cambio del atleta y qué pasó con cada una: pendiente, aplicada (y qué cambios marcó), descartada o deshecha.",
    input: z.object({
      athlete: athleteArg,
      limit: z.number().int().min(1).max(30).optional().describe("Por defecto 10."),
    }),
    readOnly: true,
    run: async ({ athlete, limit }, db) => {
      const a = await resolveAthlete(db, athlete);
      const { data, error } = await db
        .from("ai_proposals")
        .select("*")
        .eq("user_id", a.userId)
        .eq("program_id", a.ctx.program.id)
        .order("created_at", { ascending: false })
        .limit(limit ?? 10);
      if (error) throw new Error(error.message);
      return json(
        (data ?? []).map((p) => {
          const changes = Array.isArray(p.changes)
            ? (p.changes as Array<{ title?: string }>)
            : [];
          return compact({
            id: p.id,
            createdAt: p.created_at.slice(0, 10),
            status: p.status,
            phase: a.ctx.phases.find((ph) => ph.id === p.phase_id)?.key,
            request: p.question,
            rationale: p.rationale,
            changes: changes.map((c, i) =>
              p.status === "applied" || p.status === "undone"
                ? `${p.accepted_indices.includes(i) ? "✓" : "✗"} ${c.title}`
                : c.title,
            ),
            dropped: Array.isArray(p.dropped) && p.dropped.length ? p.dropped : null,
          });
        }),
      );
    },
  }),

  tool({
    name: "propose_changes",
    title: "Proponer cambios",
    description:
      "Deja una propuesta PENDIENTE en el Editor de la app: el atleta marca qué cambios acepta y los aplica (y puede deshacerlos). Sustituye a la propuesta pendiente anterior. Una fase por propuesta: la actual por defecto, o una futura con phaseKey. Ops: add_exercise, remove_exercise, move_exercise, rename_exercise (sustituir por otro del catálogo), set_sets, set_reps, set_rest, set_day_slot, set_wave, set_run (la carrera de una semana: slotId + week + prescription + structure), note (consejo sin cambio). Cada cambio lleva title / from / to / why cortos, en español: es lo que el atleta lee. Los que rompen las reglas vuelven en dropped con el motivo.",
    input: z.object({
      athlete: athleteArg,
      phaseKey: z
        .string()
        .max(8)
        .optional()
        .describe("Fase a cambiar (p. ej. F3). Por defecto la actual."),
      request: z
        .string()
        .min(1)
        .max(1000)
        .describe("Lo que el atleta te ha contado o pedido, resumido en primera persona. Se ve en Editor como su mensaje."),
      rationale: z
        .string()
        .min(1)
        .max(1600)
        .describe("Tu criterio en 2-5 frases: por qué estos cambios y qué no cambias. Se ve en Editor como tu respuesta."),
      changes: z.array(changeOpSchema).min(1).max(24),
    }),
    readOnly: false,
    run: async ({ athlete, phaseKey, request, rationale, changes }, db) => {
      const a = await resolveAthlete(db, athlete);
      const current = a.ctx.phases.find((p) => p.id === a.placement.phase.id)!;
      const phase = phaseKey
        ? a.ctx.phases.find((p) => p.key.toLowerCase() === phaseKey.toLowerCase())
        : current;
      if (!phase) {
        throw new ToolError(`No hay fase "${phaseKey}". Mira get_plan.`);
      }
      if (phase.position < current.position) {
        throw new ToolError(`La fase ${phase.key} ya ha terminado.`);
      }

      const catalog = await loadCatalog(
        db,
        a.userId,
        (a.ctx.profile.available_equipment ?? []).map(String),
      );
      const { kept, dropped } = filterOwnedChanges(changes, a, phase.id, catalog);
      if (kept.length === 0) {
        throw new ToolError(
          `Ningún cambio pasa las reglas, no se ha guardado nada: ${json(
            dropped.map((d) => ({ title: d.op.title, reason: d.reason })),
          )}`,
        );
      }

      const { data: thread, error: threadError } = await db
        .from("ai_threads")
        .insert({
          user_id: a.userId,
          program_id: a.ctx.program.id,
          title: request.slice(0, 80),
        })
        .select("id")
        .single();
      if (threadError) throw new Error(threadError.message);
      // A multi-row insert sends null for any column one row omits, so
      // both rows carry meta.
      const { data: messages, error: messageError } = await db
        .from("ai_messages")
        .insert([
          {
            thread_id: thread.id,
            user_id: a.userId,
            role: "user",
            content: request,
            meta: {},
          },
          {
            thread_id: thread.id,
            user_id: a.userId,
            role: "assistant",
            content: rationale,
            meta: { model: "claude (mcp)" },
          },
        ])
        .select("id, role");
      if (messageError) throw new Error(messageError.message);

      const { data: proposal, error } = await db
        .from("ai_proposals")
        .insert({
          thread_id: thread.id,
          message_id: messages.find((m) => m.role === "assistant")?.id ?? null,
          user_id: a.userId,
          program_id: a.ctx.program.id,
          phase_id: phase.id,
          question: request,
          rationale,
          changes: kept as unknown as Json,
          dropped: dropped as unknown as Json,
          status: "pending",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      // Editor shows the newest proposal only; an older pending one
      // would sit invisible forever.
      await db
        .from("ai_proposals")
        .update({ status: "discarded" })
        .eq("user_id", a.userId)
        .eq("program_id", a.ctx.program.id)
        .eq("status", "pending")
        .neq("id", proposal.id);

      revalidatePath("/editor");
      return json({
        proposalId: proposal.id,
        phase: phase.key,
        pending: kept.map((c) => c.title),
        dropped: dropped.map((d) => ({ title: d.op.title, reason: d.reason })),
        next: "Pendiente en Editor → Refinar con IA: el atleta marca los cambios y los aplica. Las reglas del plan se comprueban otra vez al aplicar.",
      });
    },
  }),
];
