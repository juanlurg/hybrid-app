/**
 * Replay a bloques-export JSON into a Supabase project — the inverse of
 * /api/export, for the day the free-tier project is lost.
 *
 *   1. Bring the schema up:  npx supabase db reset   (or db push in prod)
 *   2. Sign the athlete up once (creates the auth user + profile row).
 *   3. npx tsx scripts/restore.ts bloques-export-YYYY-MM-DD.json
 *        [--user <auth-user-id>]   defaults to matching the dump's email
 *        [--force]                 allow a non-local target
 *
 * Ids are preserved verbatim (the restoreSnapshot pattern: anything
 * referencing them still resolves); only two links cross environments
 * and are re-mapped via slug against the target's catalogue:
 * program_exercises.exercise_id and lifts.exercise_id. Athlete-created
 * exercises (owner_id set) ride the dump and are restored first, so
 * their links survive too — only unknown global slugs drop.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Database } from "../src/lib/supabase/database.types";

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
    // Environment already set, or nothing to load.
  }
}
loadEnv();

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL_ || !SERVICE) {
  console.error("Missing Supabase env. Fill .env.local first.");
  process.exit(1);
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const force = args.includes("--force");
const userFlag = args.indexOf("--user");
const userArg = userFlag >= 0 ? args[userFlag + 1] : null;

if (!file) {
  console.error("Usage: npx tsx scripts/restore.ts <export.json> [--user <id>] [--force]");
  process.exit(1);
}

const isLocal = /127\.0\.0\.1|localhost/.test(URL_);
if (!isLocal && !force) {
  console.error(
    `Target ${URL_} is not local. Re-run with --force if you REALLY mean to restore into it.`,
  );
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

interface ExportPayload {
  format: string;
  version: number;
  userId: string;
  email: string | null;
  profile: Row | null;
  programs: Row[];
  programPhases: Row[];
  programSlots: Row[];
  programDays: Row[];
  programExercises: Row[];
  programRunSessions: Row[];
  programLiftDefaults?: Row[];
  lifts: Row[];
  sessions: Row[];
  setLogs: Row[];
  runLogs: Row[];
  mobilityLogs: Row[];
  engineEvents: Row[];
  measurements: Row[];
  exercisesCatalog?: Row[];
  mobilityItemsCatalog?: Row[];
  aiThreads?: Row[];
  aiMessages?: Row[];
  aiProposals?: Row[];
}

// Columns that existed in older dumps but no longer in the schema.
const DROPPED_PROFILE_COLUMNS = [
  "units", "distance_unit", "zone_model",
  "notify_session", "notify_deload", "notify_weekly_summary",
];

const admin = createClient<Database>(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const payload = JSON.parse(
    readFileSync(resolve(process.cwd(), file!), "utf8"),
  ) as ExportPayload;
  if (payload.format !== "bloques-export") {
    throw new Error(`Not a bloques export: format "${payload.format}"`);
  }
  console.log(`bloques-export v${payload.version} · ${payload.email ?? payload.userId}`);

  /* ── the target athlete ──────────────────────────────────────── */
  let targetUserId = userArg;
  if (!targetUserId) {
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    const match = data.users.find((u) => u.email === payload.email);
    if (!match) {
      throw new Error(
        `No auth user with email ${payload.email}. Sign up first or pass --user <id>.`,
      );
    }
    targetUserId = match.id;
  }
  console.log(`restoring as user ${targetUserId}`);

  /* ── athlete-created exercises ride the dump ─────────────────── */
  // The target's seeded catalogue only has the global rows; custom ones
  // (owner_id set) must land first or their links re-map to null. Matched
  // by slug against the owner-scoped unique key, owner rewritten.
  const customExercises = (payload.exercisesCatalog ?? []).filter(
    (e) => e.owner_id != null,
  );
  if (customExercises.length) {
    const { data: owned, error: ownedError } = await admin
      .from("exercises")
      .select("slug")
      .eq("owner_id", targetUserId);
    if (ownedError) throw new Error(`exercises: ${ownedError.message}`);
    const ownedSlugs = new Set((owned ?? []).map((e) => e.slug));
    await upsertAll(
      "exercises",
      customExercises.filter((e) => !ownedSlugs.has(e.slug as string)),
      (r) => ({ ...r, owner_id: targetUserId }),
    );
  }

  /* ── slug maps: the only cross-environment links ─────────────── */
  const { data: targetExercises, error: exercisesError } = await admin
    .from("exercises")
    .select("id, slug, owner_id")
    .or(`owner_id.is.null,owner_id.eq.${targetUserId}`);
  if (exercisesError) throw new Error(`exercises: ${exercisesError.message}`);
  // The athlete's rows shadow a same-slug global row, like the app does.
  const targetBySlug = new Map<string, string>();
  for (const e of targetExercises ?? []) {
    if (e.owner_id === null && targetBySlug.has(e.slug)) continue;
    targetBySlug.set(e.slug, e.id);
  }
  const dumpById = new Map(
    (payload.exercisesCatalog ?? []).map((e) => [e.id as string, e.slug as string]),
  );
  if (!payload.exercisesCatalog?.length) {
    console.warn(
      `WARNING: this dump (v${payload.version}) carries no exercise catalogue — ` +
        "every catalogue link will be dropped. Re-export with the current app for a v2 dump.",
    );
  }
  let droppedLinks = 0;
  const remapExerciseId = (id: string | null): string | null => {
    if (id == null) return null;
    const slug = dumpById.get(id);
    const mapped = (slug && targetBySlug.get(slug)) || null;
    if (mapped == null) droppedLinks += 1;
    return mapped;
  };

  const asUser = (row: Row): Row => ({ ...row, user_id: targetUserId });

  async function upsertAll(table: string, rows: Row[], transform?: (r: Row) => Row) {
    if (!rows.length) {
      console.log(`  ${table}: 0`);
      return;
    }
    const prepared = rows.map((r) => (transform ? transform(r) : r));
    for (let i = 0; i < prepared.length; i += 500) {
      const chunk = prepared.slice(i, i + 500);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (admin.from(table as any) as any).upsert(chunk, {
        onConflict: "id",
      });
      if (error) throw new Error(`${table}: ${error.message}`);
    }
    console.log(`  ${table}: ${prepared.length}`);
  }

  /* ── profile: update the trigger-created row in place ────────── */
  if (payload.profile) {
    const profile: Row = { ...payload.profile, id: targetUserId };
    for (const col of DROPPED_PROFILE_COLUMNS) delete profile[col];
    const { error } = await admin
      .from("profiles")
      .update(profile as never)
      .eq("id", targetUserId);
    if (error) throw new Error(`profiles: ${error.message}`);
    console.log("  profiles: 1");
  }

  /* ── FK order, ids verbatim ──────────────────────────────────── */
  await upsertAll("programs", payload.programs, asUser);
  await upsertAll("program_phases", payload.programPhases);
  await upsertAll("program_slots", payload.programSlots);
  await upsertAll("program_exercises", payload.programExercises, (r) => ({
    ...r,
    exercise_id: remapExerciseId(r.exercise_id),
  }));
  // program_days has no id column: upsert on its natural key.
  if (payload.programDays.length) {
    const { error } = await admin
      .from("program_days")
      .upsert(payload.programDays as never[], {
        onConflict: "phase_id,day_index",
      });
    if (error) throw new Error(`program_days: ${error.message}`);
  }
  console.log(`  program_days: ${payload.programDays.length}`);
  await upsertAll("program_run_sessions", payload.programRunSessions);
  await upsertAll(
    "program_lift_defaults",
    payload.programLiftDefaults ?? [],
  );
  await upsertAll("lifts", payload.lifts, (r) => ({
    ...asUser(r),
    exercise_id: remapExerciseId(r.exercise_id),
  }));
  await upsertAll("sessions", payload.sessions, asUser);
  await upsertAll("set_logs", payload.setLogs, (r) => ({
    ...asUser(r),
    program_exercise_id: r.program_exercise_id ?? null,
  }));
  await upsertAll("run_logs", payload.runLogs, asUser);
  await upsertAll("mobility_logs", payload.mobilityLogs, asUser);
  await upsertAll("engine_events", payload.engineEvents, asUser);
  await upsertAll("measurements", payload.measurements, asUser);
  await upsertAll("ai_threads", payload.aiThreads ?? [], asUser);
  await upsertAll("ai_messages", payload.aiMessages ?? [], asUser);
  await upsertAll("ai_proposals", payload.aiProposals ?? [], asUser);

  if (droppedLinks > 0) {
    console.warn(
      `\nWARNING: ${droppedLinks} catalogue link(s) could not be re-mapped ` +
        "and were restored as null (equipment resolution and AI substitutions " +
        "lose those rows). Names and lift keys are intact.",
    );
  }
  console.log("\nDone. Open the app and check Hoy, Historial and Programa.");
}

main().catch((error) => {
  console.error("\nrestore failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
