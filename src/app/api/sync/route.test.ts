import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_ENGINE_CONFIG } from "@/lib/engine";
import { loadAthlete } from "@/lib/data/athlete";

import { POST } from "./route";

/**
 * The sync endpoint against an in-memory Supabase: enough of the query
 * builder (select/insert/update/upsert + eq/in/is/order, onConflict with
 * ignoreDuplicates) to replay real flushes. What these tests pin down is
 * exactly the retry semantics unit tests cannot reach: double flushes,
 * flushes that died halfway, and re-flushes racing a manual RM edit.
 */

vi.mock("@/lib/data/athlete", () => ({ loadAthlete: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => makeClient(),
  getUser: async () => ({ id: USER, email: null }),
}));

const USER = "u-1";
const PHASE_ID = "11111111-1111-4111-8111-111111111111";
const SLOT_ID = "22222222-2222-4222-8222-222222222222";
const PRIMARY_ID = "33333333-3333-4333-8333-333333333333";
const ACCESSORY_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_ID = "55555555-5555-4555-8555-555555555555";
const LIFT_ID = "lift-1";

/* ── in-memory supabase ──────────────────────────────────────── */

type Row = Record<string, unknown>;

let tables: Record<string, Row[]>;
let seq: number;

function resetDb() {
  tables = {
    sessions: [],
    set_logs: [],
    engine_events: [],
    lifts: [],
    program_exercises: [],
    program_phases: [],
  };
  seq = 0;
}

class Query {
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private rows: Row[] = [];
  private patch: Row = {};
  private filters: Array<(r: Row) => boolean> = [];
  private conflictCols: string[] | null = null;
  private ignoreDuplicates = false;
  private orderCol: string | null = null;

  constructor(private table: string) {}

  select() {
    return this;
  }
  insert(data: Row | Row[]) {
    this.op = "insert";
    this.rows = Array.isArray(data) ? data : [data];
    return this;
  }
  upsert(
    data: Row | Row[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) {
    this.op = "upsert";
    this.rows = Array.isArray(data) ? data : [data];
    this.conflictCols = opts?.onConflict ? opts.onConflict.split(",") : null;
    this.ignoreDuplicates = opts?.ignoreDuplicates ?? false;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v);
    return this;
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[col]));
    return this;
  }
  gt(col: string, v: unknown) {
    this.filters.push((r) => String(r[col]) > String(v));
    return this;
  }
  is(col: string, v: unknown) {
    this.filters.push((r) => (v === null ? r[col] == null : r[col] === v));
    return this;
  }
  order(col: string) {
    this.orderCol = col;
    return this;
  }

  private defaults(r: Row): Row {
    if (r.id == null) r.id = `${this.table}-${++seq}`;
    if (this.table === "engine_events" && r.created_at == null) {
      // Monotonic, and always later than any pre-seeded timestamp.
      r.created_at = new Date(Date.UTC(2026, 7, 4, 12, 0, ++seq)).toISOString();
    }
    return r;
  }

  private exec(): Row[] {
    const t = tables[this.table] ?? (tables[this.table] = []);
    switch (this.op) {
      case "select": {
        let out = t.filter((r) => this.filters.every((f) => f(r)));
        if (this.orderCol) {
          const c = this.orderCol;
          out = [...out].sort((a, b) =>
            (a[c] as number) > (b[c] as number) ? 1 : -1,
          );
        }
        return out.map((r) => ({ ...r }));
      }
      case "insert": {
        const inserted = this.rows.map((r) => this.defaults({ ...r }));
        t.push(...inserted);
        return inserted.map((r) => ({ ...r }));
      }
      case "update": {
        const hit = t.filter((r) => this.filters.every((f) => f(r)));
        for (const r of hit) Object.assign(r, this.patch);
        return hit.map((r) => ({ ...r }));
      }
      case "upsert": {
        const touched: Row[] = [];
        for (const row of this.rows) {
          const match = this.conflictCols
            ? t.find((r) => this.conflictCols!.every((c) => r[c] === row[c]))
            : undefined;
          if (match) {
            if (!this.ignoreDuplicates) {
              Object.assign(match, row);
              touched.push({ ...match });
            }
            // ignoreDuplicates: the skipped row is NOT returned — this
            // is the exact behaviour the :bump: dedup relies on.
          } else {
            const inserted = this.defaults({ ...row });
            t.push(inserted);
            touched.push({ ...inserted });
          }
        }
        return touched;
      }
    }
  }

  maybeSingle() {
    const d = this.exec();
    return Promise.resolve({ data: d[0] ?? null, error: null });
  }
  single() {
    const d = this.exec();
    return d.length
      ? Promise.resolve({ data: d[0], error: null })
      : Promise.resolve({ data: null, error: { message: "single: no rows" } });
  }
  then<A, B>(
    onFulfilled: (v: { data: Row[]; error: null }) => A,
    onRejected?: (e: unknown) => B,
  ) {
    return Promise.resolve({ data: this.exec(), error: null }).then(
      onFulfilled,
      onRejected,
    );
  }
}

function makeClient() {
  return { from: (table: string) => new Query(table) };
}

/* ── fixtures ────────────────────────────────────────────────── */

const phaseRow = {
  id: PHASE_ID,
  program_id: "prog-1",
  key: "F2",
  name: "F2",
  position: 1,
  weeks: 12,
  starts_on: "2026-09-14",
  wave: null,
  cycle_weeks: null,
  progression_mode: "wave",
  pct_of_rm: null,
  auto_deload: null,
};

const primaryExercise = {
  id: PRIMARY_ID,
  slot_id: SLOT_ID,
  position: 1,
  name: "Sentadilla",
  sets: 3,
  rep_min: 5,
  rep_max: 6,
  rest_seconds: 180,
  is_primary: true,
  load_mode: "engine",
  lift_key: "sentadilla",
  fixed_weight_kg: null,
  effort: "reps",
  equipment: "barbell",
};

const accessoryExercise = {
  id: ACCESSORY_ID,
  slot_id: SLOT_ID,
  position: 2,
  name: "Remo",
  sets: 2,
  rep_min: 8,
  rep_max: 10,
  rest_seconds: 90,
  is_primary: false,
  load_mode: "fixed",
  lift_key: null,
  fixed_weight_kg: 40,
  effort: "reps",
  equipment: "barbell",
};

function liftRow(over: Row = {}): Row {
  return {
    id: LIFT_ID,
    user_id: USER,
    key: "sentadilla",
    name: "Sentadilla",
    kind: "lower",
    e1rm_kg: 120,
    penalty: 0,
    fail_count: 0,
    hold: false,
    hold_at_kg: null,
    ...over,
  };
}

function seed(lift: Row = liftRow()) {
  resetDb();
  tables.lifts.push({ ...lift });
  tables.program_exercises.push({ ...primaryExercise }, { ...accessoryExercise });
  vi.mocked(loadAthlete).mockResolvedValue({
    userId: USER,
    email: null,
    ctx: {
      profile: { lthr: null },
      program: { id: "prog-1" },
      phases: [phaseRow],
      slots: [],
      days: [],
      exercises: [{ ...primaryExercise }, { ...accessoryExercise }],
      prescriptions: [],
      lifts: [{ ...lift }],
    },
    config: DEFAULT_ENGINE_CONFIG,
    today: "2026-09-14",
    placement: {},
    seasonWeeks: 39,
    // The route only reads the fields above.
  } as unknown as Awaited<ReturnType<typeof loadAthlete>>);
}

type SetOver = Partial<{
  programExerciseId: string;
  liftKey: string | null;
  exerciseName: string;
  position: number;
  setIndex: number;
  reps: number | null;
  seconds: number | null;
  rir: number | null;
  weightKg: number | null;
  substituted: boolean;
  loggedAt: string;
}>;

function primarySet(setIndex: number, reps: number, over: SetOver = {}) {
  return {
    programExerciseId: PRIMARY_ID,
    liftKey: "sentadilla",
    exerciseName: "Sentadilla",
    position: 1,
    setIndex,
    reps,
    seconds: null,
    rir: null,
    weightKg: 90,
    loggedAt: `2026-09-14T18:0${setIndex}:00Z`,
    ...over,
  };
}

function accessorySet(setIndex: number, reps: number, over: SetOver = {}) {
  return {
    programExerciseId: ACCESSORY_ID,
    liftKey: null,
    exerciseName: "Remo",
    position: 2,
    setIndex,
    reps,
    seconds: null,
    rir: 2,
    weightKg: 40,
    loggedAt: `2026-09-14T18:3${setIndex}:00Z`,
    ...over,
  };
}

function body(input: {
  week?: number;
  sets: unknown[];
  finish?: boolean;
}) {
  return {
    protocolVersion: 1,
    deviceId: "d-1",
    sessions: [
      {
        localSessionId: SESSION_ID,
        key: {
          phaseId: PHASE_ID,
          slotId: SLOT_ID,
          scheduledOn: "2026-09-14",
          week: input.week ?? 1,
          dayIndex: 0,
          sessionType: "strength",
          title: "Fuerza A",
        },
        startedAt: "2026-09-14T18:00:00Z",
        sets: input.sets,
        undoneFailures: [],
        finish: input.finish ? { finishedAt: "2026-09-14T19:00:00Z" } : null,
        opKeys: ["k-1"],
      },
    ],
    runLogs: [],
    mobilityLogs: [],
  };
}

async function flush(payload: unknown) {
  const res = await POST(
    new Request("http://test/api/sync", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  );
  const json = await res.json();
  // A transient envelope failure would otherwise pass silently.
  expect(json.failures).toEqual([]);
  return json;
}

const events = (kind: string) =>
  tables.engine_events.filter((e) => e.kind === kind);

const cleanSession = () =>
  body({
    sets: [
      primarySet(0, 5),
      primarySet(1, 5),
      primarySet(2, 6),
      accessorySet(0, 10),
      accessorySet(1, 10),
    ],
    finish: true,
  });

beforeEach(() => seed());

/* ── double progression retries (finding 4) ──────────────────── */

describe("accessory bump retry semantics", () => {
  it("a double flush awards the +2.5 kg exactly once", async () => {
    await flush(cleanSession());
    expect(events("accessory_bump")).toHaveLength(1);
    const accessory = tables.program_exercises.find((e) => e.id === ACCESSORY_ID)!;
    expect(accessory.fixed_weight_kg).toBe(42.5);

    await flush(cleanSession());
    expect(events("accessory_bump")).toHaveLength(1);
    expect(accessory.fixed_weight_kg).toBe(42.5);
  });

  it("a retry after dying between the status write and the bumps still lands them", async () => {
    // The first flush persisted status "done" and died: the session row
    // exists closed, the bump does not. The old `!alreadyClosed` gate
    // turned this retry into a silent skip.
    tables.sessions.push({
      id: SESSION_ID,
      user_id: USER,
      status: "done",
      started_at: "2026-09-14T18:00:00Z",
      phase_id: PHASE_ID,
      slot_id: SLOT_ID,
      scheduled_on: "2026-09-14",
      week: 1,
    });
    await flush(cleanSession());
    expect(events("accessory_bump")).toHaveLength(1);
    expect(
      tables.program_exercises.find((e) => e.id === ACCESSORY_ID)!
        .fixed_weight_kg,
    ).toBe(42.5);
  });
});

/* ── re-flush vs manual RM edit (finding 5) ──────────────────── */

describe("late re-flush vs a manual RM edit", () => {
  function seedFailedSessionWithEdit(editCreatedAt: string) {
    // The first flush recorded the miss (fail event, previous = 120);
    // then the athlete corrected the RM to 130 (manual_rm resets the
    // regression state). The lift row and ctx both hold the edit.
    seed(liftRow({ e1rm_kg: 130 }));
    tables.sessions.push({
      id: SESSION_ID,
      user_id: USER,
      status: "in_progress",
      started_at: "2026-09-14T18:00:00Z",
      phase_id: PHASE_ID,
      slot_id: SLOT_ID,
      scheduled_on: "2026-09-14",
      week: 1,
    });
    tables.engine_events.push(
      {
        id: "ev-fail",
        dedup_key: `${SESSION_ID}:fail:1:0`,
        user_id: USER,
        program_id: "prog-1",
        lift_id: LIFT_ID,
        session_id: SESSION_ID,
        week: 1,
        kind: "fail_hold",
        payload: {
          previous: {
            e1rmKg: 120,
            penalty: 0,
            failCount: 0,
            hold: false,
            holdAtKg: null,
          },
        },
        reverted_at: null,
        created_at: "2026-08-01T10:00:00.000Z",
      },
      {
        id: "ev-manual",
        dedup_key: null,
        user_id: USER,
        program_id: "prog-1",
        lift_id: LIFT_ID,
        session_id: null,
        week: 1,
        kind: "manual_rm",
        payload: null,
        reverted_at: null,
        created_at: editCreatedAt,
      },
    );
  }

  it("the fold's row-write yields; sets and events still land", async () => {
    seedFailedSessionWithEdit("2026-08-02T09:00:00.000Z"); // after the fail
    await flush(body({ sets: [primarySet(0, 4)] }));

    const lift = tables.lifts[0];
    expect(lift.e1rm_kg).toBe(130); // the edit survives
    expect(lift.hold).toBe(false);
    expect(lift.fail_count).toBe(0);
    // Everything else still landed.
    expect(tables.set_logs).toHaveLength(1);
    expect(events("fail_hold")).toHaveLength(1);
  });

  it("without a newer edit the fold persists as always", async () => {
    seedFailedSessionWithEdit("2026-07-30T09:00:00.000Z"); // before the fail
    await flush(body({ sets: [primarySet(0, 4)] }));

    const lift = tables.lifts[0];
    expect(lift.e1rm_kg).toBe(120); // rewound to the fold's result
    expect(lift.hold).toBe(true);
    expect(lift.fail_count).toBe(1);
  });
});

/* ── substituted sets (finding 6) ────────────────────────────── */

describe("substituted sets", () => {
  it("a substituted primary set: no fail, no clean, the engine holds still — accessories still progress", async () => {
    await flush(
      body({
        sets: [
          primarySet(0, 3, { substituted: true }),
          primarySet(1, 5),
          primarySet(2, 5),
          accessorySet(0, 10),
          accessorySet(1, 10),
        ],
        finish: true,
      }),
    );

    // Stored as history, but never as a miss.
    const sub = tables.set_logs.find((l) => l.set_index === 0 && l.position === 1)!;
    expect(sub.missed_range).toBe(false);
    expect(events("fail_hold")).toHaveLength(0);
    expect(events("fail_penalty")).toHaveLength(0);
    expect(events("clean_reset")).toHaveLength(0);
    expect(tables.lifts[0]).toMatchObject({ e1rm_kg: 120, fail_count: 0 });
    // The exclusion is per exercise: the untouched accessory still bumps.
    expect(events("accessory_bump")).toHaveLength(1);
  });

  it("a substituted accessory never bumps", async () => {
    await flush(
      body({
        sets: [
          primarySet(0, 5),
          primarySet(1, 5),
          primarySet(2, 5),
          accessorySet(0, 10, { substituted: true }),
          accessorySet(1, 10, { substituted: true }),
        ],
        finish: true,
      }),
    );
    expect(events("accessory_bump")).toHaveLength(0);
    expect(
      tables.program_exercises.find((e) => e.id === ACCESSORY_ID)!
        .fixed_weight_kg,
    ).toBe(40);
  });
});

/* ── the wave-aware rep floor (finding 3) ────────────────────── */

describe("missed_range uses the week's floor", () => {
  it("one rep under on the 85 % week is not a miss", async () => {
    await flush(body({ week: 3, sets: [primarySet(0, 4)] }));
    expect(tables.set_logs[0].missed_range).toBe(false);
    expect(events("fail_hold")).toHaveLength(0);
  });

  it("the same reps on the 75 % week burn the strike", async () => {
    await flush(body({ week: 1, sets: [primarySet(0, 4)] }));
    expect(tables.set_logs[0].missed_range).toBe(true);
    expect(events("fail_hold")).toHaveLength(1);
    expect(tables.lifts[0].hold).toBe(true);
  });
});
