import { requireAthlete } from "@/lib/data/athlete";
import { createClient } from "@/lib/supabase/server";
import { hasGeminiKey } from "@/lib/ai/gemini";
import { groupOf, resolveWeek, type SessionGroup } from "@/lib/domain/plan";
import { DAY_LABELS, formatDayShort } from "@/lib/domain/calendar";
import { cycleOf, isDeloadWeek, weekInCycle } from "@/lib/engine";
import { changeOpSchema, type ChangeOp } from "@/lib/ai/schema";

import { ProgramEditor } from "./program-editor";

export interface EditorWarning {
  tone: "warn" | "fail";
  title: string;
  detail: string;
}

export default async function EditorPage() {
  const athlete = await requireAthlete();
  const { ctx, config, placement } = athlete;
  const phase = ctx.phases.find((p) => p.id === placement.phase.id)!;

  const slots = ctx.slots
    .filter((s) => s.phase_id === phase.id)
    .sort((a, b) => a.position - b.position);

  const week = resolveWeek({
    ctx,
    config,
    phase,
    week: placement.week,
    absoluteWeek: placement.absoluteWeek,
  });

  const supabase = await createClient();
  const { data: proposalRow } = await supabase
    .from("ai_proposals")
    .select("*")
    .eq("user_id", athlete.userId)
    .eq("program_id", ctx.program.id)
    .in("status", ["pending", "applied"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: messages } = proposalRow?.thread_id
    ? await supabase
        .from("ai_messages")
        .select("role, content, created_at")
        .eq("thread_id", proposalRow.thread_id)
        .order("created_at")
        .limit(40)
    : { data: null };

  const { data: appliedRows } = await supabase
    .from("ai_proposals")
    .select("id")
    .eq("user_id", athlete.userId)
    .eq("program_id", ctx.program.id)
    .eq("status", "applied");

  const changes: ChangeOp[] = Array.isArray(proposalRow?.changes)
    ? (proposalRow.changes as unknown[])
        .map((c) => changeOpSchema.safeParse(c))
        .filter((r) => r.success)
        .map((r) => r.data)
    : [];

  /* ── plan validator ─────────────────────────────────────────── */

  const warnings: EditorWarning[] = [];
  const longIndex = week.findIndex((d) => d.slot?.session_type === "run_long");
  if (longIndex > 0 && week[longIndex - 1].group === "strength") {
    warnings.push({
      tone: "warn",
      title: `Fricción · ${week[longIndex - 1].title} el día antes de la larga`,
      detail:
        "Menos de 18 h entre cadena posterior pesada y la tirada larga. Si la larga se cae dos semanas seguidas, mueve la fuerza al jueves antes de tocar volumen.",
    });
  }

  for (const slot of slots) {
    if (groupOf(slot.session_type) !== "strength") continue;
    const sets = ctx.exercises
      .filter((e) => e.slot_id === slot.id)
      .reduce((acc, e) => acc + e.sets, 0);
    if (sets > 18) {
      warnings.push({
        tone: "warn",
        title: `${slot.label}: ${sets} series ≈ ${Math.round(sets * 3.1 + 12)} min`,
        detail:
          "Por encima de 70 minutos la calidad de las últimas series cae. Recorta accesorio antes que series del básico.",
      });
    }
    if (!ctx.exercises.some((e) => e.slot_id === slot.id && e.is_primary)) {
      warnings.push({
        tone: "fail",
        title: `${slot.label} sin básico`,
        detail:
          "Sin un básico marcado, la regla de regresión no tiene a qué agarrarse: esa sesión no mueve el motor.",
      });
    }
  }

  if (!week.some((d) => d.group === "mobility")) {
    warnings.push({
      tone: "fail",
      title: "Sin bloque de movilidad",
      detail:
        "Los correctivos eran innegociables en el plan original: 20 minutos diarios de glúteo, psoas y tobillo.",
    });
  }

  const strengthDays = week.filter((d) => d.group === "strength").length;
  const runDays = week.filter((d) => d.group === "run").length;
  if (strengthDays > 3 && runDays >= 2) {
    warnings.push({
      tone: "fail",
      title: `${strengthDays} días de fuerza con ${runDays} de carrera`,
      detail:
        "Seis sesiones duras y un día libre. En híbrido eso se paga en la tirada larga antes que en el gimnasio.",
    });
  }

  return (
    <ProgramEditor
      programName={ctx.program.name}
      phase={{ id: phase.id, key: phase.key, name: phase.name, weeks: phase.weeks }}
      week={placement.week}
      absoluteWeek={placement.absoluteWeek}
      isDeload={isDeloadWeek(placement.absoluteWeek, config)}
      cycle={cycleOf(placement.absoluteWeek, config.cycleWeeks)}
      waveIndex={weekInCycle(placement.absoluteWeek, config.cycleWeeks)}
      wave={[...config.wave]}
      params={{
        incLowerKg: config.incLowerKg,
        incUpperKg: config.incUpperKg,
        roundingKg: config.roundingKg,
        targetRir: ctx.profile.target_rir,
        regressionRule: config.regressionRule,
      }}
      days={week.map((d) => ({
        dayIndex: d.dayIndex,
        dayLabel: DAY_LABELS[d.dayIndex],
        dateLabel: formatDayShort(d.date),
        slotId: d.slot?.id ?? null,
        title: d.title,
        subtitle: d.subtitle,
        group: d.group as SessionGroup,
        load:
          d.group === "strength"
            ? `${d.totalSets} series`
            : d.group === "run"
              ? d.prescription || "carrera"
              : d.group === "mobility"
                ? "9 ejercicios"
                : "—",
        minutes: d.estimatedMinutes,
      }))}
      slots={slots.map((s) => ({
        id: s.id,
        key: s.key,
        label: s.label,
        title: s.title,
        group: groupOf(s.session_type) as SessionGroup,
      }))}
      exercises={ctx.exercises
        .filter((e) => slots.some((s) => s.id === e.slot_id))
        .sort((a, b) => a.position - b.position)
        .map((e) => ({
          id: e.id,
          slotId: e.slot_id,
          name: e.name,
          tag: e.tag,
          sets: e.sets,
          repMin: e.rep_min,
          repMax: e.rep_max,
          restSeconds: e.rest_seconds,
          isPrimary: e.is_primary,
        }))}
      warnings={warnings}
      hasApiKey={hasGeminiKey()}
      thread={{
        id: proposalRow?.thread_id ?? null,
        messages: (messages ?? []).map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
      }}
      pendingProposal={
        proposalRow && proposalRow.status === "pending"
          ? {
              id: proposalRow.id,
              question: proposalRow.question,
              rationale: proposalRow.rationale,
              changes,
              status: proposalRow.status,
            }
          : null
      }
      lastApplied={
        proposalRow && proposalRow.status === "applied"
          ? { id: proposalRow.id, count: proposalRow.accepted_indices.length }
          : null
      }
      appliedTotal={(appliedRows ?? []).length}
    />
  );
}
