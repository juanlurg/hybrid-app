/**
 * End-to-end smoke test against the local Supabase stack.
 *
 *   npx tsx scripts/smoke.ts
 *
 * Exercises the parts that unit tests cannot: RLS isolation between two
 * athletes, the clone RPC, and the single write path itself — it boots
 * `next dev` on :3111 and POSTs real sync envelopes at /api/sync,
 * asserting the engine reacts and that a repeated flush changes nothing
 * (non-negotiable 7). A server that fails to boot fails the run.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  spawn,
  spawnSync,
  type ChildProcess,
} from "node:child_process";

import type { Database } from "../src/lib/supabase/database.types";
import {
  workingWeightKg,
  DEFAULT_ENGINE_CONFIG,
  formatWeight,
} from "../src/lib/engine";
import { parseStructure } from "../src/lib/engine/run";
import { addDays } from "../src/lib/domain/calendar";

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
  const { data: signIn, error: signInError } =
    await client.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) {
    throw new Error(`signIn: ${signInError?.message}`);
  }

  return { id: created.user.id, email, client, session: signIn.session };
}

async function cleanup(ids: string[]) {
  for (const id of ids) await admin.auth.admin.deleteUser(id);
}

/* ── the app server, for POSTing at /api/sync ────────────────── */

const APP_PORT = 3111;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;

let appServer: ChildProcess | null = null;

function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    child.kill("SIGTERM");
  }
}

async function startAppServer(): Promise<void> {
  const bin = resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  appServer = spawn(process.execPath, [bin, "dev", "-p", String(APP_PORT)], {
    cwd: process.cwd(),
    stdio: "ignore",
    env: process.env,
  });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${APP_URL}/entrar`);
      if (res.status < 500) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`next dev did not come up on :${APP_PORT} within 120 s`);
}

/**
 * The cookie @supabase/ssr reads on the server: `sb-<ref>-auth-token`
 * holding `base64-` + base64url(session JSON), chunked when oversized.
 */
function authCookie(session: object): string {
  const ref = new globalThis.URL(URL).hostname.split(".")[0];
  const name = `sb-${ref}-auth-token`;
  const value =
    "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const MAX = 3180;
  if (value.length <= MAX) return `${name}=${value}`;
  const parts: string[] = [];
  for (let i = 0; i * MAX < value.length; i += 1) {
    parts.push(`${name}.${i}=${value.slice(i * MAX, (i + 1) * MAX)}`);
  }
  return parts.join("; ");
}

/* ── the run ─────────────────────────────────────────────────── */

async function main() {
  const created: string[] = [];

  // Boot the app in the background; the sync section awaits it.
  const serverReady = startAppServer();
  serverReady.catch(() => {});

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
    check("it has 4 phases", phaseCount === 4, `got ${phaseCount}`);

    const { data: maestroF4 } = await admin
      .from("program_phases")
      .select("id, weeks, starts_on")
      .eq("program_id", template!.id)
      .eq("key", "F4")
      .single();
    const [{ data: f4Days }, { data: f4Slots }] = await Promise.all([
      admin
        .from("program_days")
        .select("day_index, slot_id")
        .eq("phase_id", maestroF4!.id),
      admin
        .from("program_slots")
        .select("id, session_type")
        .eq("phase_id", maestroF4!.id),
    ]);
    const f4SlotType = new Map(f4Slots!.map((s) => [s.id, s.session_type]));
    check(
      "F4 has its mobility Friday — the blocking rule can't veto the race block",
      f4Days!.some(
        (d) => d.day_index === 4 && f4SlotType.get(d.slot_id) === "mobility",
      ),
    );
    const { data: maestroRow } = await admin
      .from("programs")
      .select("race_on")
      .eq("id", template!.id)
      .single();
    check(
      "race_on is the Saturday of F4's final week — the MEDIA MARATÓN day",
      maestroRow?.race_on ===
        addDays(maestroF4!.starts_on!, (maestroF4!.weeks - 1) * 7 + 5),
      maestroRow?.race_on ?? "null",
    );

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
        p_starts_on: "2026-08-17",
        p_lthr: 168,
      },
    );
    check("onboard_athlete succeeds", !onboardError, onboardError?.message);

    const { data: phasesA } = await a.client
      .from("program_phases")
      .select("key, weeks, starts_on")
      .eq("program_id", programAId!)
      .order("position");
    check("the clone has 4 phases", phasesA?.length === 4);
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
      .select("id, name, is_primary, slot_id, position, rep_min, lift_key")
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

    section("Weight engine end to end — through POST /api/sync");
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

    // The basic's real place in the clone: its slot, phase and weekday.
    const { data: basicSlot } = await a.client
      .from("program_slots")
      .select("id, phase_id, title")
      .eq("id", basic!.slot_id)
      .single();
    const { data: basicPhase } = await a.client
      .from("program_phases")
      .select("id, starts_on")
      .eq("id", basicSlot!.phase_id)
      .single();
    const { data: basicDay } = await a.client
      .from("program_days")
      .select("day_index")
      .eq("phase_id", basicSlot!.phase_id)
      .eq("slot_id", basic!.slot_id)
      .maybeSingle();
    const scheduledOn = addDays(
      basicPhase!.starts_on!,
      (week - 1) * 7 + basicDay!.day_index,
    );

    await serverReady;

    const swRes = await fetch(`${APP_URL}/sw.js`);
    const swText = await swRes.text();
    check(
      "the service worker route serves the worker source",
      swRes.ok &&
        swText.includes("CACHE_VERSION") &&
        swText.includes("precacheShell"),
      `status ${swRes.status}`,
    );

    const cookie = authCookie(a.session);
    const postSync = (body: unknown) =>
      fetch(`${APP_URL}/api/sync`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      });

    const localId = crypto.randomUUID();
    const sessionKey = {
      phaseId: basicPhase!.id,
      slotId: basic!.slot_id,
      scheduledOn,
      week,
      dayIndex: basicDay!.day_index,
      sessionType: "strength" as const,
      title: basicSlot!.title,
    };
    const setEnv = (setIndex: number, reps: number) => ({
      programExerciseId: basic!.id,
      liftKey: "hipthrust",
      exerciseName: basic!.name,
      position: basic!.position,
      setIndex,
      reps,
      seconds: null,
      rir: null,
      weightKg: expected,
      loggedAt: `${scheduledOn}T18:0${setIndex}:00.000Z`,
    });
    const envelope = (over: Record<string, unknown>) => ({
      protocolVersion: 1,
      deviceId: "smoke",
      sessions: [
        {
          localSessionId: localId,
          key: sessionKey,
          startedAt: `${scheduledOn}T18:00:00.000Z`,
          sets: [],
          undoneFailures: [],
          finish: null,
          opKeys: [],
          ...over,
        },
      ],
      runLogs: [],
      mobilityLogs: [],
    });

    // Flush 1: session start + one missed set. The engine must react.
    const res1 = await postSync(
      envelope({
        sets: [setEnv(0, basic!.rep_min - 1)],
        opKeys: [
          `${localId}:start`,
          `${localId}:set:${basic!.position}:0`,
        ],
      }),
    );
    const body1 = await res1.json();
    check("flush 1 lands (start + missed set)", res1.status === 200 && body1.ok);
    check(
      "flush 1 acks its op keys",
      (body1.ackedKeys ?? []).length === 2,
      JSON.stringify(body1.ackedKeys),
    );

    const liftAfter1 = await a.client
      .from("lifts")
      .select("e1rm_kg, penalty, fail_count, hold, hold_at_kg")
      .eq("user_id", a.id)
      .eq("key", "hipthrust")
      .single();
    check(
      "the first miss freezes the weight at 127.5 kg",
      liftAfter1.data?.hold === true &&
        Number(liftAfter1.data.hold_at_kg) === 127.5 &&
        liftAfter1.data.fail_count === 1,
      JSON.stringify(liftAfter1.data),
    );

    // Flush 2 arrives WITHOUT the start op (already acked) and so
    // without a key — the flow that used to 400 and poison the queue.
    // A clean second set plus the finish; the replay re-reads all logs,
    // so the fold must NOT escalate the recorded miss a second time.
    const res2 = await postSync(
      envelope({
        key: null,
        startedAt: null,
        sets: [setEnv(1, basic!.rep_min + 2)],
        finish: { finishedAt: `${scheduledOn}T19:00:00.000Z` },
        opKeys: [
          `${localId}:set:${basic!.position}:1`,
          `${localId}:finish`,
        ],
      }),
    );
    const body2 = await res2.json();
    check(
      "flush 2 without a key lands — the 400 that wedged the queue is dead",
      res2.status === 200 && body2.ok,
      `status ${res2.status}`,
    );
    check(
      "flush 2 closes the session as partial",
      body2.results?.[0]?.status === "partial",
      body2.results?.[0]?.status,
    );

    const liftAfter2 = await a.client
      .from("lifts")
      .select("e1rm_kg, penalty, fail_count, hold, hold_at_kg")
      .eq("user_id", a.id)
      .eq("key", "hipthrust")
      .single();
    check(
      "the re-replay does not escalate the miss (idempotent rewind)",
      liftAfter2.data?.fail_count === 1 &&
        Number(liftAfter2.data.penalty) === 0 &&
        Number(liftAfter2.data.e1rm_kg) === 150,
      JSON.stringify(liftAfter2.data),
    );

    // Flush 3 repeats flush 2 byte for byte — the dead-halfway retry.
    const res3 = await postSync(
      envelope({
        key: null,
        startedAt: null,
        sets: [setEnv(1, basic!.rep_min + 2)],
        finish: { finishedAt: `${scheduledOn}T19:00:00.000Z` },
        opKeys: [
          `${localId}:set:${basic!.position}:1`,
          `${localId}:finish`,
        ],
      }),
    );
    check("a repeated flush still answers ok", (await res3.json()).ok === true);

    const liftAfter3 = await a.client
      .from("lifts")
      .select("e1rm_kg, penalty, fail_count, hold, hold_at_kg")
      .eq("user_id", a.id)
      .eq("key", "hipthrust")
      .single();
    check(
      "a repeated flush changes nothing on the lift",
      JSON.stringify(liftAfter3.data) === JSON.stringify(liftAfter2.data),
      JSON.stringify(liftAfter3.data),
    );

    const { data: sessionEvents } = await a.client
      .from("engine_events")
      .select("kind, dedup_key")
      .eq("session_id", localId);
    check(
      "exactly one fail_hold event, no fail_penalty, dedup_key set",
      sessionEvents?.filter((e) => e.kind === "fail_hold").length === 1 &&
        sessionEvents?.filter((e) => e.kind === "fail_penalty").length === 0 &&
        sessionEvents!.every((e) => e.kind !== "fail_hold" || e.dedup_key),
      JSON.stringify(sessionEvents),
    );

    // Flush 4: the athlete corrects the missed set from its pill. The
    // persisted hold must unwind and the stale fail event must revert.
    const res4 = await postSync(
      envelope({
        key: null,
        startedAt: null,
        sets: [setEnv(0, basic!.rep_min + 1)],
        opKeys: [`${localId}:set:${basic!.position}:0`],
      }),
    );
    check("correcting the missed set lands", (await res4.json()).ok === true);
    const liftAfter4 = await a.client
      .from("lifts")
      .select("e1rm_kg, penalty, fail_count, hold, hold_at_kg")
      .eq("user_id", a.id)
      .eq("key", "hipthrust")
      .single();
    check(
      "the correction unwinds the hold entirely",
      liftAfter4.data?.hold === false &&
        liftAfter4.data.fail_count === 0 &&
        Number(liftAfter4.data.penalty) === 0 &&
        Number(liftAfter4.data.e1rm_kg) === 150,
      JSON.stringify(liftAfter4.data),
    );
    const { data: eventsAfter4 } = await a.client
      .from("engine_events")
      .select("kind, reverted_at")
      .eq("session_id", localId)
      .eq("kind", "fail_hold");
    check(
      "the stale fail event is reverted, not deleted",
      eventsAfter4?.length === 1 && eventsAfter4[0].reverted_at != null,
      JSON.stringify(eventsAfter4),
    );

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

    section("Primer 10K template");
    const { data: tenK } = await admin
      .from("programs")
      .select("id, name")
      .eq("is_template", true)
      .eq("slug", "plan-10k-base")
      .maybeSingle();
    check("the Primer 10K template exists", Boolean(tenK));
    if (!tenK) throw new Error("no 10k template — run `npm run db:reset` first");

    const { data: tenKPhases } = await admin
      .from("program_phases")
      .select("id, key, weeks, progression_mode, pct_of_rm, wave, cycle_weeks")
      .eq("program_id", tenK.id)
      .order("position");
    check("it has 5 phases over 22 weeks", tenKPhases?.length === 5);
    check(
      "the weeks add up to 22",
      tenKPhases?.reduce((sum, p) => sum + p.weeks, 0) === 22,
      `got ${tenKPhases?.reduce((sum, p) => sum + p.weeks, 0)}`,
    );
    check(
      "every phase wave is as long as its cycle",
      tenKPhases!.every((p) => !p.wave || p.wave.length === p.cycle_weeks),
      "a shorter wave than cycle_weeks makes the editor print NaN %",
    );
    check(
      "F3 holds a fixed % instead of waving",
      tenKPhases!.find((p) => p.key === "F3")?.progression_mode === "fixed_pct",
    );

    const tenKPhaseIds = tenKPhases!.map((p) => p.id);
    const { data: tenKSlots } = await admin
      .from("program_slots")
      .select("id, key, phase_id, session_type")
      .in("phase_id", tenKPhaseIds);
    const { data: tenKDays } = await admin
      .from("program_days")
      .select("phase_id, day_index, slot_id")
      .in("phase_id", tenKPhaseIds);
    const slotById = new Map(tenKSlots!.map((s) => [s.id, s]));

    check(
      "every phase has its 7 days",
      tenKPhaseIds.every(
        (id) => tenKDays!.filter((d) => d.phase_id === id).length === 7,
      ),
    );
    // The three blocking rules in src/lib/domain/plan-rules.ts, per phase.
    check(
      "every week has a mobility day, 2 strength days and its run days (2 in the puente, 3 after)",
      tenKPhases!.every((phase) => {
        const types = tenKDays!
          .filter((d) => d.phase_id === phase.id)
          .map((d) => slotById.get(d.slot_id)!.session_type);
        return (
          types.filter((t) => t === "mobility").length === 1 &&
          types.filter((t) => t === "strength").length === 2 &&
          types.filter((t) => t.startsWith("run")).length ===
            (phase.key === "F00" ? 2 : 3)
        );
      }),
    );

    const { data: tenKExercises } = await admin
      .from("program_exercises")
      .select(
        "slot_id, name, is_primary, exercise_id, load_mode, lift_key, fixed_weight_kg, equipment",
      )
      .in(
        "slot_id",
        tenKSlots!.filter((s) => s.session_type === "strength").map((s) => s.id),
      );
    const strengthSlotIds = tenKSlots!
      .filter((s) => s.session_type === "strength")
      .map((s) => s.id);
    check(
      "every strength slot has exactly one basic",
      strengthSlotIds.every(
        (id) =>
          tenKExercises!.filter((e) => e.slot_id === id && e.is_primary).length === 1,
      ),
    );
    check(
      "every exercise resolved against the catalogue",
      tenKExercises!.every((e) => e.exercise_id !== null),
      tenKExercises!.find((e) => e.exercise_id === null)?.name,
    );
    check(
      "no fixed row is missing its start load",
      tenKExercises!.every(
        (e) => e.load_mode !== "fixed" || e.fixed_weight_kg !== null,
      ),
      "a fixed row without a weight renders “—”",
    );
    const { data: tenKDefaults } = await admin
      .from("program_lift_defaults")
      .select("lift_key, default_e1rm_kg")
      .eq("program_id", tenK.id);
    const seededKeys = new Set(tenKDefaults!.map((d) => d.lift_key));
    check(
      "every engine row has a seeded RM behind it",
      tenKExercises!.every(
        (e) => e.load_mode !== "engine" || seededKeys.has(e.lift_key!),
      ),
      "an engine row without a lift renders “—” forever",
    );

    const { data: tenKRuns } = await admin
      .from("program_run_sessions")
      .select("phase_id, slot_id, week, prescription, target_minutes, structure")
      .in("phase_id", tenKPhaseIds);
    check("there are 62 run sessions", tenKRuns?.length === 62, `got ${tenKRuns?.length}`);
    check(
      "every run slot covers every week of its phase",
      tenKPhases!.every((phase) =>
        tenKSlots!
          .filter((s) => s.phase_id === phase.id && s.session_type.startsWith("run"))
          .every(
            (slot) =>
              new Set(
                tenKRuns!.filter((r) => r.slot_id === slot.id).map((r) => r.week),
              ).size === phase.weeks,
          ),
      ),
    );
    check(
      "every run session carries its own minutes",
      tenKRuns!.every((r) => r.target_minutes !== null),
      "structureMinutes prices km at 5:30/km — too fast for this athlete",
    );
    const unparsed = tenKRuns!.find((r) => parseStructure(r.structure) === null);
    check(
      "every run structure parses",
      !unparsed,
      unparsed && `${unparsed.prescription}: ${JSON.stringify(unparsed.structure)}`,
    );

    section("Athlete C — the 10K plan");
    const c = await makeAthlete("c");
    created.push(c.id);
    const { data: programCId, error: onboardCError } = await c.client.rpc(
      "onboard_athlete",
      {
        p_display_name: "Atleta C",
        p_template_slug: "plan-10k-base",
        p_starts_on: "2026-09-14",
      },
    );
    check("onboarding onto the 10K plan succeeds", !onboardCError, onboardCError?.message);

    const { data: phasesC } = await c.client
      .from("program_phases")
      .select("key, weeks, starts_on")
      .eq("program_id", programCId!)
      .order("position");
    check("the clone has 5 phases", phasesC?.length === 5);
    check(
      "F0 starts four weeks in, on 12 Oct 2026 — the puente owns the chosen Monday",
      phasesC?.find((p) => p.key === "F0")?.starts_on === "2026-10-12",
      phasesC?.find((p) => p.key === "F0")?.starts_on,
    );

    const { data: liftsC } = await c.client
      .from("lifts")
      .select("key, e1rm_kg")
      .eq("user_id", c.id)
      .order("key");
    check(
      "only the two basics are tracked",
      liftsC?.length === 2,
      `got ${liftsC?.map((l) => l.key).join(", ")}`,
    );
    check(
      "no militar lift, because the plan uses the landmine",
      !liftsC?.some((l) => l.key === "militar"),
    );
    check(
      "the squat starts at a beginner-scale 35 kg",
      Number(liftsC?.find((l) => l.key === "sentadilla")?.e1rm_kg) === 35,
    );

    section("Sync vs archived and missing programmes");
    // Signed in but never onboarded: the syncer must be told "no active
    // programme", not "session expired".
    const d = await makeAthlete("d");
    created.push(d.id);
    const noProgram = await fetch(`${APP_URL}/api/sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authCookie(d.session),
      },
      body: JSON.stringify({
        protocolVersion: 1,
        deviceId: "smoke",
        sessions: [],
        runLogs: [],
        mobilityLogs: [],
      }),
    });
    check(
      "no active programme → 409, not 401",
      noProgram.status === 409,
      `status ${noProgram.status}`,
    );

    // C switches to the maestro, archiving the 10K plan — a session
    // still queued under the 10K must land under the 10K, engine off.
    const { data: cOldPhase } = await c.client
      .from("program_phases")
      .select("id, starts_on")
      .eq("program_id", programCId!)
      .order("position")
      .limit(1)
      .single();
    const { data: cOldSlot } = await c.client
      .from("program_slots")
      .select("id, title")
      .eq("phase_id", cOldPhase!.id)
      .eq("session_type", "strength")
      .limit(1)
      .single();
    const { data: cOldDay } = await c.client
      .from("program_days")
      .select("day_index")
      .eq("phase_id", cOldPhase!.id)
      .eq("slot_id", cOldSlot!.id)
      .single();
    const { data: cOldExercise } = await c.client
      .from("program_exercises")
      .select("id, name, position, rep_min")
      .eq("slot_id", cOldSlot!.id)
      .order("position")
      .limit(1)
      .single();

    await c.client.rpc("onboard_athlete", {
      p_template_slug: "plan-maestro-hibrido",
      p_starts_on: "2026-09-14",
    });

    const cLocalId = crypto.randomUUID();
    const cScheduled = addDays(cOldPhase!.starts_on!, cOldDay!.day_index);
    const archivedRes = await fetch(`${APP_URL}/api/sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authCookie(c.session),
      },
      body: JSON.stringify({
        protocolVersion: 1,
        deviceId: "smoke",
        sessions: [
          {
            localSessionId: cLocalId,
            key: {
              phaseId: cOldPhase!.id,
              slotId: cOldSlot!.id,
              scheduledOn: cScheduled,
              week: 1,
              dayIndex: cOldDay!.day_index,
              sessionType: "strength",
              title: cOldSlot!.title,
            },
            startedAt: `${cScheduled}T18:00:00.000Z`,
            sets: [
              {
                programExerciseId: cOldExercise!.id,
                liftKey: null,
                exerciseName: cOldExercise!.name,
                position: cOldExercise!.position,
                setIndex: 0,
                reps: cOldExercise!.rep_min,
                seconds: null,
                rir: null,
                weightKg: 30,
                loggedAt: `${cScheduled}T18:05:00.000Z`,
              },
            ],
            undoneFailures: [],
            finish: null,
            opKeys: [`${cLocalId}:start`, `${cLocalId}:set:1:0`],
          },
        ],
        runLogs: [],
        mobilityLogs: [],
      }),
    });
    const archivedBody = await archivedRes.json();
    check(
      "a session for an archived programme lands, engine skipped",
      archivedRes.status === 200 &&
        archivedBody.ok === true &&
        archivedBody.results?.[0]?.engineSkipped === true,
      JSON.stringify(archivedBody.results ?? archivedBody),
    );
    const { data: archivedSession } = await c.client
      .from("sessions")
      .select("program_id")
      .eq("id", cLocalId)
      .single();
    check(
      "…and under ITS programme, not the active one",
      archivedSession?.program_id === programCId,
      archivedSession?.program_id ?? "null",
    );
  } finally {
    if (appServer) killTree(appServer);
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
