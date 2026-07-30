/**
 * End-to-end smoke test against the local Supabase stack.
 *
 *   npx tsx scripts/smoke.ts
 *
 * Exercises the parts that unit tests cannot: RLS isolation between two
 * athletes, the clone RPC, and the weight engine actually moving a lift
 * when a set misses its range.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Database } from "../src/lib/supabase/database.types";
import {
  registerFailure,
  workingWeightKg,
  DEFAULT_ENGINE_CONFIG,
  formatWeight,
} from "../src/lib/engine";

/* ── env ─────────────────────────────────────────────────────── */

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const value = match[2].replace(/^["']|["']$/g, "");
      if (!process.env[match[1]]) process.env[match[1]] = value;
    }
  } catch {
    // Fall through to whatever is already in the environment.
  }
}
loadEnv();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!URL || !ANON || !SERVICE) {
  console.error("Missing Supabase env. Run `npx supabase status` and fill .env.local.");
  process.exit(1);
}

/* ── tiny harness ────────────────────────────────────────────── */

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string | null) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label + (detail ? ` — ${detail}` : ""));
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

const admin = createClient<Database>(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function makeAthlete(tag: string) {
  const email = `smoke-${tag}-${Date.now()}@bloques.test`;
  const password = "correcthorsebatterystaple";

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `Smoke ${tag}` },
  });
  if (error || !created.user) throw new Error(`createUser: ${error?.message}`);

  const client = createClient<Database>(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw new Error(`signIn: ${signInError.message}`);

  return { id: created.user.id, email, client };
}

async function cleanup(ids: string[]) {
  for (const id of ids) await admin.auth.admin.deleteUser(id);
}

/* ── the run ─────────────────────────────────────────────────── */

async function main() {
  const created: string[] = [];

  try {
    section("Template programme");
    const { data: template, error: templateError } = await admin
      .from("programs")
      .select("id, name, starts_on")
      .eq("is_template", true)
      .eq("slug", "plan-maestro-hibrido")
      .maybeSingle();
    check(
      "the Plan Maestro template exists",
      Boolean(template),
      templateError?.message,
    );
    if (!template) throw new Error("no template — run `npm run db:reset` first");

    const { count: phaseCount } = await admin
      .from("program_phases")
      .select("*", { count: "exact", head: true })
      .eq("program_id", template!.id);
    check("it has 5 phases", phaseCount === 5, `got ${phaseCount}`);

    section("Athlete A — signup and onboarding");
    const a = await makeAthlete("a");
    created.push(a.id);

    const { data: profileA } = await a.client
      .from("profiles")
      .select("*")
      .eq("id", a.id)
      .maybeSingle();
    check("the signup trigger created a profile", Boolean(profileA));
    check(
      "the default plate kit can reach a 2.5 kg step",
      (profileA?.plates_kg ?? []).map(Number).includes(1.25),
    );

    const { data: programAId, error: onboardError } = await a.client.rpc(
      "onboard_athlete",
      {
        p_display_name: "Atleta A",
        p_template_slug: "plan-maestro-hibrido",
        p_starts_on: "2026-07-27",
        p_lthr: 168,
      },
    );
    check("onboard_athlete succeeds", !onboardError, onboardError?.message);

    const { data: phasesA } = await a.client
      .from("program_phases")
      .select("key, weeks, starts_on")
      .eq("program_id", programAId!)
      .order("position");
    check("the clone has 5 phases", phasesA?.length === 5);
    check(
      "F2 starts on 14 Sep 2026, as the plan says",
      phasesA?.find((p) => p.key === "F2")?.starts_on === "2026-09-14",
      phasesA?.find((p) => p.key === "F2")?.starts_on,
    );

    const { data: liftsA } = await a.client
      .from("lifts")
      .select("key, name, e1rm_kg, kind")
      .eq("user_id", a.id)
      .order("key");
    check("5 tracked lifts were created", liftsA?.length === 5, `got ${liftsA?.length}`);
    const hipThrust = liftsA?.find((l) => l.key === "hipthrust");
    check("hip thrust starts at 150 kg", Number(hipThrust?.e1rm_kg) === 150);

    const { data: exercisesA } = await a.client
      .from("program_exercises")
      .select("id, name, is_primary, slot_id, rep_min, lift_key")
      .in(
        "slot_id",
        (
          await a.client
            .from("program_slots")
            .select("id, phase_id")
            .in(
              "phase_id",
              (
                await a.client
                  .from("program_phases")
                  .select("id")
                  .eq("program_id", programAId!)
              ).data!.map((p) => p.id),
            )
        ).data!.map((s) => s.id),
      );
    check("the exercise list was cloned", (exercisesA?.length ?? 0) > 40);
    check(
      "no slot has two basics",
      new Set(
        exercisesA!.filter((e) => e.is_primary).map((e) => e.slot_id),
      ).size === exercisesA!.filter((e) => e.is_primary).length,
    );

    section("Athlete B — isolation");
    const b = await makeAthlete("b");
    created.push(b.id);
    await b.client.rpc("onboard_athlete", {
      p_template_slug: "plan-maestro-hibrido",
      p_starts_on: "2027-01-04",
    });

    const { data: bSeesPrograms } = await b.client
      .from("programs")
      .select("id, is_template")
      .eq("is_template", false);
    check(
      "B sees exactly one non-template programme",
      bSeesPrograms?.length === 1,
      `got ${bSeesPrograms?.length}`,
    );
    check(
      "B cannot see A's programme",
      !bSeesPrograms?.some((p) => p.id === programAId),
    );

    const { data: bSeesLifts } = await b.client.from("lifts").select("id, user_id");
    check(
      "B sees only their own lifts",
      Boolean(bSeesLifts?.length) && bSeesLifts!.every((l) => l.user_id === b.id),
    );

    const { error: crossWrite } = await b.client
      .from("lifts")
      .update({ e1rm_kg: 999 })
      .eq("user_id", a.id);
    const { data: aLiftAfter } = await a.client
      .from("lifts")
      .select("e1rm_kg")
      .eq("user_id", a.id)
      .eq("key", "hipthrust")
      .maybeSingle();
    check(
      "B cannot write to A's lifts",
      Number(aLiftAfter?.e1rm_kg) === 150,
      crossWrite?.message ?? `now ${aLiftAfter?.e1rm_kg}`,
    );

    const { error: templateWrite } = await a.client
      .from("programs")
      .update({ name: "hijacked" })
      .eq("id", template!.id);
    const { data: templateAfter } = await admin
      .from("programs")
      .select("name")
      .eq("id", template!.id)
      .single();
    check(
      "the shared template is read-only",
      templateAfter?.name === "Plan Maestro — Atleta Híbrido",
      templateWrite?.message,
    );

    section("Weight engine end to end");
    const week = 3; // 85 % of the wave
    const expected = workingWeightKg(
      {
        id: hipThrust!.key,
        name: hipThrust!.name,
        kind: hipThrust!.kind,
        e1rmKg: Number(hipThrust!.e1rm_kg),
        penalty: 0,
        failCount: 0,
        hold: false,
        holdAtKg: null,
      },
      week,
      DEFAULT_ENGINE_CONFIG,
    );
    check(
      "hip thrust in week 3 is 127.5 kg",
      expected === 127.5,
      `got ${formatWeight(expected)}`,
    );

    const basic = exercisesA!.find(
      (e) => e.is_primary && e.lift_key === "hipthrust",
    );
    check("the hip thrust basic exists in the plan", Boolean(basic));

    const { data: session } = await a.client
      .from("sessions")
      .insert({
        user_id: a.id,
        program_id: programAId!,
        scheduled_on: "2026-09-30",
        week,
        day_index: 2,
        session_type: "strength",
        title: "Fuerza B",
        status: "in_progress",
      })
      .select("id")
      .single();
    check("a session can be created", Boolean(session));

    const { error: logError } = await a.client.from("set_logs").insert({
      session_id: session!.id,
      user_id: a.id,
      program_exercise_id: basic!.id,
      lift_key: "hipthrust",
      exercise_name: basic!.name,
      position: 1,
      set_index: 0,
      weight_kg: expected,
      reps: basic!.rep_min - 1,
      missed_range: true,
    });
    check("a missed set can be logged", !logError, logError?.message);

    // Same transition the server action performs.
    const outcome = registerFailure(
      {
        id: hipThrust!.key,
        name: hipThrust!.name,
        kind: hipThrust!.kind,
        e1rmKg: Number(hipThrust!.e1rm_kg),
        penalty: 0,
        failCount: 0,
        hold: false,
        holdAtKg: null,
      },
      expected,
      week,
      DEFAULT_ENGINE_CONFIG,
    );
    check("the first miss freezes the weight", outcome.action === "hold");

    await a.client
      .from("lifts")
      .update({
        fail_count: outcome.lift.failCount,
        hold: outcome.lift.hold,
        hold_at_kg: outcome.lift.holdAtKg,
      })
      .eq("user_id", a.id)
      .eq("key", "hipthrust");

    const { data: heldLift } = await a.client
      .from("lifts")
      .select("hold, hold_at_kg, fail_count")
      .eq("user_id", a.id)
      .eq("key", "hipthrust")
      .single();
    check(
      "the lift is now held at the missed weight",
      heldLift?.hold === true && Number(heldLift.hold_at_kg) === 127.5,
      JSON.stringify(heldLift),
    );

    const { error: eventError } = await a.client.from("engine_events").insert({
      user_id: a.id,
      program_id: programAId!,
      session_id: session!.id,
      week,
      kind: "fail_hold",
      title: outcome.title,
      detail: outcome.detail,
    });
    check("the engine event is recorded", !eventError, eventError?.message);

    section("AI proposal storage");
    const { data: thread } = await a.client
      .from("ai_threads")
      .insert({ user_id: a.id, program_id: programAId!, title: "smoke" })
      .select("id")
      .single();
    const { error: proposalError } = await a.client.from("ai_proposals").insert({
      thread_id: thread!.id,
      user_id: a.id,
      program_id: programAId!,
      question: "smoke",
      rationale: "smoke",
      changes: [{ op: "note", title: "t", from: "", to: "", why: "" }],
    });
    check("a proposal can be stored", !proposalError, proposalError?.message);

    const { data: bSeesProposals } = await b.client
      .from("ai_proposals")
      .select("id");
    check("B cannot see A's proposals", bSeesProposals?.length === 0);
  } finally {
    await cleanup(created);
  }

  console.log(
    `\n${passed} passed, ${failures.length} failed` +
      (failures.length ? `\n\n${failures.map((f) => `  · ${f}`).join("\n")}\n` : "\n"),
  );
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error("\nsmoke run threw:", error);
  process.exit(1);
});
