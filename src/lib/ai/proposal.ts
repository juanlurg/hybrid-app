import type { SupabaseClient } from "@supabase/supabase-js";

import type { LoadedAthlete } from "@/lib/data/athlete";
import { groupOf } from "@/lib/domain/plan";
import type { Database } from "@/lib/supabase/database.types";
import type { ChangeOp } from "@/lib/ai/schema";

/**
 * What both coaches share — the in-app Gemini one (`actions/ai.ts`) and
 * the Claude one behind `/api/mcp`: the catalogue an athlete can rack,
 * and the filter every proposal passes at propose AND apply time.
 */

/* ── catalogue ───────────────────────────────────────────────── */

export interface CatalogRow {
  id: string;
  slug: string;
  name: string;
  modality: Database["public"]["Enums"]["load_mode"];
  equipment: Database["public"]["Enums"]["equipment_kind"];
  default_rest_seconds: number;
  pattern: string | null;
}

/**
 * The exercises this athlete can actually rack, keyed by slug. Filters
 * by owner itself — RLS does it for the athlete's own client, but the
 * service-role client behind `/api/mcp` would see everyone's.
 */
export async function loadCatalog(
  supabase: SupabaseClient<Database>,
  userId: string,
  available: readonly string[],
): Promise<Map<string, CatalogRow>> {
  const { data } = await supabase
    .from("exercises")
    .select("id, slug, name, modality, equipment, default_rest_seconds, pattern")
    .or(`owner_id.is.null,owner_id.eq.${userId}`)
    .order("name");
  const rows = (data ?? []).filter((c) =>
    available.includes(String(c.equipment)),
  );
  return new Map(rows.map((r) => [r.slug, r as CatalogRow]));
}

/* ── ownership filter ────────────────────────────────────────── */

export interface DroppedChange {
  op: ChangeOp;
  reason: string;
}

/**
 * The ownership/sanity filter, shared by propose AND apply: apply must
 * re-check because the plan can change between the two. Drops anything
 * that points outside this athlete's phase, names an exercise off the
 * catalogue, or touches the regression trigger (the primary) — and says
 * WHY, so a change the rationale narrates never just vanishes.
 */
export function filterOwnedChanges(
  changes: ChangeOp[],
  athlete: LoadedAthlete,
  phaseId: string,
  catalog: Map<string, CatalogRow>,
): { kept: ChangeOp[]; dropped: DroppedChange[] } {
  const phase = athlete.ctx.phases.find((p) => p.id === phaseId);
  const slotsById = new Map(
    athlete.ctx.slots.filter((s) => s.phase_id === phaseId).map((s) => [s.id, s]),
  );
  const exercisesById = new Map(
    athlete.ctx.exercises
      .filter((e) => slotsById.has(e.slot_id))
      .map((e) => [e.id, e]),
  );

  const reasonFor = (c: ChangeOp): string | null => {
    if (c.exerciseId && !exercisesById.has(c.exerciseId)) {
      return "el ejercicio ya no está en esta fase del plan";
    }
    if (c.slotId && !slotsById.has(c.slotId)) {
      return "la sesión no pertenece a esta fase";
    }
    if (c.targetSlotId && !slotsById.has(c.targetSlotId)) {
      return "la sesión de destino no pertenece a esta fase";
    }
    if (
      (c.op === "add_exercise" || c.op === "rename_exercise") &&
      (!c.exerciseSlug || !catalog.has(c.exerciseSlug))
    ) {
      return "el ejercicio no está en el catálogo disponible";
    }
    // Never let a proposal orphan or mutate the regression trigger.
    if (
      (c.op === "remove_exercise" ||
        c.op === "move_exercise" ||
        c.op === "rename_exercise") &&
      c.exerciseId &&
      exercisesById.get(c.exerciseId)?.is_primary
    ) {
      return "el básico no se toca: es el que dispara la regresión";
    }
    if (c.op === "set_run") {
      if (groupOf(slotsById.get(c.slotId!)!.session_type) !== "run") {
        return "solo se cambia la carrera de una sesión de carrera";
      }
      if (c.week! > phase!.weeks) {
        return "la fase no tiene esa semana";
      }
    }
    return null;
  };

  const kept: ChangeOp[] = [];
  const dropped: DroppedChange[] = [];
  for (const c of changes) {
    const reason = reasonFor(c);
    if (reason) dropped.push({ op: c, reason });
    else kept.push(c);
  }
  return { kept, dropped };
}
