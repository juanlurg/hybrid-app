import { requireAthlete } from "@/lib/data/athlete";
import { createClient } from "@/lib/supabase/server";
import { hasGeminiKey } from "@/lib/ai/gemini";
import {
  groupOf,
  phaseEngineConfig,
  resolveWeek,
  type SessionGroup,
} from "@/lib/domain/plan";
import { planWarnings } from "@/lib/domain/plan-rules";
import { DAY_LABELS } from "@/lib/domain/calendar";
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
  const phaseConfig = phaseEngineConfig(config, phase);

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

  // The catalogue the picker offers: only what this athlete can rack.
  const availableEquipment = (ctx.profile.available_equipment ?? []).map(String);
  const { data: catalogRows } = await supabase
    .from("exercises")
    .select("id, name, equipment, pattern")
    .order("name");
  const catalog = (catalogRows ?? [])
    .filter((c) => availableEquipment.includes(String(c.equipment)))
    .map((c) => ({
      id: c.id,
      name: c.name,
      equipment: String(c.equipment),
      pattern: c.pattern,
    }));

  const changes: ChangeOp[] = Array.isArray(proposalRow?.changes)
    ? (proposalRow.changes as unknown[])
        .map((c) => changeOpSchema.safeParse(c))
        .filter((r) => r.success)
        .map((r) => r.data)
    : [];

  const dropped: Array<{ op: ChangeOp; reason: string }> = Array.isArray(
    proposalRow?.dropped,
  )
    ? (proposalRow.dropped as unknown[]).flatMap((d) => {
        const raw = d as { op?: unknown; reason?: unknown };
        const parsed = changeOpSchema.safeParse(raw.op);
        return parsed.success
          ? [{ op: parsed.data, reason: String(raw.reason ?? "") }]
          : [];
      })
    : [];

  /* ── plan validator — the same rules applyProposal enforces ──── */

  const slotIdSet = new Set(slots.map((s) => s.id));
  const warnings: EditorWarning[] = planWarnings({
    slots: slots.map((s) => ({
      id: s.id,
      label: s.label,
      sessionType: s.session_type,
    })),
    exercises: ctx.exercises
      .filter((e) => slotIdSet.has(e.slot_id))
      .map((e) => ({
        slotId: e.slot_id,
        sets: e.sets,
        isPrimary: e.is_primary,
      })),
    days: week.map((d) => ({
      dayIndex: d.dayIndex,
      slotId: d.slot?.id ?? null,
    })),
  }).map((w) => ({ tone: w.tone, title: w.title, detail: w.detail }));

  return (
    <ProgramEditor
      phase={{ id: phase.id, key: phase.key, name: phase.name, weeks: phase.weeks }}
      week={placement.week}
      absoluteWeek={placement.absoluteWeek}
      isDeload={isDeloadWeek(placement.week, phaseConfig)}
      cycle={cycleOf(placement.week, phaseConfig.cycleWeeks)}
      waveIndex={weekInCycle(placement.week, phaseConfig.cycleWeeks)}
      wave={[...phaseConfig.wave]}
      waveScope={
        phase.progression_mode === "fixed_pct"
          ? "fixed"
          : (phase.wave ?? []).map(Number).some((n) => n > 0)
            ? "phase"
            : "program"
      }
      pctOfRm={phaseConfig.pctOfRm}
      params={{
        incLowerKg: config.incLowerKg,
        incUpperKg: config.incUpperKg,
        roundingKg: config.roundingKg,
        targetRir: ctx.profile.target_rir,
        regressionRule: config.regressionRule,
      }}
      catalog={catalog}
      days={week.map((d) => ({
        dayIndex: d.dayIndex,
        dayLabel: DAY_LABELS[d.dayIndex],
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
              dropped,
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
