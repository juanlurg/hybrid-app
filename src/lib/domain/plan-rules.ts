/**
 * The plan's sanity rules, in one place. The editor renders them as
 * warnings; applyProposal enforces the blocking ones — an AI batch that
 * leaves a strength session without a basic, drops the mobility block
 * or stacks six hard days does not get applied.
 */

import { groupOf } from "./plan";
import type { SessionType } from "./plan";

export interface PlanRuleInput {
  slots: Array<{ id: string; label: string; sessionType: SessionType }>;
  exercises: Array<{ slotId: string; sets: number; isPrimary: boolean }>;
  /** The weekly template: dayIndex 0-6 → slot. */
  days: Array<{ dayIndex: number; slotId: string | null }>;
}

export interface PlanWarning {
  tone: "warn" | "fail";
  title: string;
  detail: string;
  /** True → applyProposal refuses to leave the plan in this state. */
  blocking: boolean;
}

export function planWarnings(input: PlanRuleInput): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  const slotById = new Map(input.slots.map((s) => [s.id, s]));
  const ordered = [...input.days].sort((a, b) => a.dayIndex - b.dayIndex);
  const groupAt = (i: number) => {
    const slotId = ordered[i]?.slotId;
    const slot = slotId ? slotById.get(slotId) : null;
    return slot ? groupOf(slot.sessionType) : null;
  };

  const longIndex = ordered.findIndex((d) => {
    const slot = d.slotId ? slotById.get(d.slotId) : null;
    return slot?.sessionType === "run_long";
  });
  if (longIndex > 0 && groupAt(longIndex - 1) === "strength") {
    const prev = slotById.get(ordered[longIndex - 1].slotId!)!;
    warnings.push({
      tone: "warn",
      blocking: false,
      title: `Fricción · ${prev.label} el día antes de la larga`,
      detail:
        "Menos de 18 h entre cadena posterior pesada y la tirada larga. Si la larga se cae dos semanas seguidas, mueve la fuerza al jueves antes de tocar volumen.",
    });
  }

  for (const slot of input.slots) {
    if (groupOf(slot.sessionType) !== "strength") continue;
    const rows = input.exercises.filter((e) => e.slotId === slot.id);
    const sets = rows.reduce((acc, e) => acc + e.sets, 0);
    if (sets > 18) {
      warnings.push({
        tone: "warn",
        blocking: false,
        title: `${slot.label}: ${sets} series ≈ ${Math.round(sets * 3.1 + 12)} min`,
        detail:
          "Por encima de 70 minutos la calidad de las últimas series cae. Recorta accesorio antes que series del básico.",
      });
    }
    if (rows.length > 0 && !rows.some((e) => e.isPrimary)) {
      warnings.push({
        tone: "fail",
        blocking: true,
        title: `${slot.label} sin básico`,
        detail:
          "Sin un básico marcado, la regla de regresión no tiene a qué agarrarse: esa sesión no mueve el motor.",
      });
    }
  }

  const groups = ordered.map((_, i) => groupAt(i));
  if (!groups.includes("mobility")) {
    warnings.push({
      tone: "fail",
      blocking: true,
      title: "Sin bloque de movilidad",
      detail:
        "Los correctivos eran innegociables en el plan original: 20 minutos diarios de glúteo, psoas y tobillo.",
    });
  }

  const strengthDays = groups.filter((g) => g === "strength").length;
  const runDays = groups.filter((g) => g === "run").length;
  if (strengthDays > 3 && runDays >= 2) {
    warnings.push({
      tone: "fail",
      blocking: true,
      title: `${strengthDays} días de fuerza con ${runDays} de carrera`,
      detail:
        "Seis sesiones duras y un día libre. En híbrido eso se paga en la tirada larga antes que en el gimnasio.",
    });
  }

  return warnings;
}
