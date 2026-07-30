/**
 * Deterministic replay of the regression engine over a session's set
 * logs. The SAME fold runs in the browser (to show the banner while
 * offline) and in /api/sync (to persist the truth) — client and server
 * cannot disagree because they execute identical code.
 *
 * Idempotency is the whole point: replaying N times produces the same
 * events with the same `dedupKey`s, and the sync handler inserts them
 * with `on conflict do nothing`. A flush that died halfway is safe to
 * repeat forever.
 */

import {
  isRangeFailure,
  registerFailure,
  registerCleanSession,
  workingWeight,
} from ".";
import type { EngineConfig, LiftState, RegressionOutcome } from "./types";

export interface ReplaySetLog {
  programExerciseId: string | null;
  position: number;
  setIndex: number;
  reps: number | null;
  seconds: number | null;
  weightKg: number | null;
}

export interface ReplayPrimary {
  programExerciseId: string;
  liftKey: string;
  repMin: number;
  /** Sets prescribed for the session as run (after any deload halving). */
  sets: number;
}

export interface ReplayInput {
  sessionId: string;
  /** State of the primary's lift BEFORE this session touched it. */
  lift: LiftState | null;
  primary: ReplayPrimary | null;
  logs: ReplaySetLog[];
  /** Failures the athlete undid from the banner. */
  undone: Array<{ position: number; setIndex: number }>;
  /** Week inside the phase, with the phase's own config. */
  week: number;
  config: EngineConfig;
}

export interface ReplayEvent {
  dedupKey: string;
  kind: "fail_hold" | "fail_penalty";
  title: string;
  detail: string;
  /** True when the athlete undid it: persist with reverted_at set, never touch lifts. */
  undone: boolean;
  sourceSet: { position: number; setIndex: number };
  outcome: RegressionOutcome;
  /** Lift state right before this failure applied — the exact undo target. */
  previous: LiftState;
}

export interface ReplayResult {
  /** Post-session state of the primary's lift. Null when nothing applies. */
  lift: LiftState | null;
  events: ReplayEvent[];
  /** Every prescribed set of the basic logged, all inside the range. */
  clean: boolean;
  /** True when this clean session actually cleared a hold/fail count. */
  released: boolean;
  cleanDedupKey: string;
  /** What the runner shows: the last failure that still stands. */
  banner: { title: string; detail: string; tone: "warn" | "fail" } | null;
}

export function failDedupKey(
  sessionId: string,
  position: number,
  setIndex: number,
): string {
  return `${sessionId}:fail:${position}:${setIndex}`;
}

export function replayEngine(input: ReplayInput): ReplayResult {
  const { sessionId, primary, config, week } = input;
  const cleanDedupKey = `${sessionId}:clean`;

  if (!primary || !input.lift) {
    return {
      lift: null,
      events: [],
      clean: false,
      released: false,
      cleanDedupKey,
      banner: null,
    };
  }

  const undoneSet = new Set(
    input.undone.map((u) => `${u.position}:${u.setIndex}`),
  );

  const primaryLogs = input.logs
    .filter((l) => l.programExerciseId === primary.programExerciseId)
    .sort((a, b) => a.setIndex - b.setIndex);

  let lift = input.lift;
  const events: ReplayEvent[] = [];
  let banner: ReplayResult["banner"] = null;

  for (const log of primaryLogs) {
    const achieved = log.reps ?? log.seconds ?? 0;
    if (!isRangeFailure(achieved, primary.repMin)) continue;

    const undone = undoneSet.has(`${log.position}:${log.setIndex}`);
    const previous = lift;
    const outcome = registerFailure(lift, log.weightKg ?? 0, week, config);

    events.push({
      dedupKey: failDedupKey(sessionId, log.position, log.setIndex),
      kind: outcome.action === "hold" ? "fail_hold" : "fail_penalty",
      title: outcome.title,
      detail: outcome.detail,
      undone,
      sourceSet: { position: log.position, setIndex: log.setIndex },
      outcome,
      previous,
    });

    // An undone failure is history, not state: the event is recorded
    // (already reverted) but the fold continues from where it was.
    if (!undone) {
      lift = outcome.lift;
      banner = {
        title: outcome.title,
        detail: outcome.detail,
        tone: outcome.action === "hold" ? "warn" : "fail",
      };
    }
  }

  const liveMisses = events.filter((e) => !e.undone).length;
  const clean =
    primaryLogs.length >= primary.sets &&
    primaryLogs.every((l) =>
      !isRangeFailure(l.reps ?? l.seconds ?? 0, primary.repMin),
    );

  let released = false;
  if (clean && liveMisses === 0) {
    // The hold is a cap that only some weeks reach: a clean deload (or
    // early-cycle week) never tested the held weight, so it must not
    // release it — "se repite cuando la ola lo alcance" has to stay
    // true. Only a clean session where the cap actually bound clears
    // the hold; a plain fail-count (no hold) clears on any clean one.
    const tested = !lift.hold || workingWeight(lift, week, config).isHeld;
    if (tested) {
      const next = registerCleanSession(lift);
      released = next !== lift;
      lift = next;
    }
  }

  return { lift, events, clean, released, cleanDedupKey, banner };
}

/**
 * Decode the `previous` snapshot out of an engine event payload.
 * Payloads written before 2026-07-31 used the lifts-table column names
 * (e1rm_kg, fail_count, hold_at_kg); newer ones store LiftState
 * verbatim. Accept both — reading only the camelCase keys silently
 * no-opped the rewind and made every re-flush escalate a single miss
 * into RM cuts.
 */
export function parsePreviousLiftState(
  raw: unknown,
): Partial<LiftState> | null {
  if (raw == null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const previous: Partial<LiftState> = {};

  const e1rm = r.e1rmKg ?? r.e1rm_kg;
  if (e1rm != null) previous.e1rmKg = Number(e1rm);
  if (r.penalty != null) previous.penalty = Number(r.penalty);
  const failCount = r.failCount ?? r.fail_count;
  if (failCount != null) previous.failCount = Number(failCount);
  if (r.hold != null) previous.hold = Boolean(r.hold);
  const holdAt = "holdAtKg" in r ? r.holdAtKg : r.hold_at_kg;
  if (holdAt !== undefined) {
    previous.holdAtKg = holdAt == null ? null : Number(holdAt);
  }
  return previous;
}

/**
 * The lift state this session started from, reconstructed from the
 * events already persisted for it. Every engine event stores the state
 * it acted on (`previous`); the earliest one for the session IS the
 * pre-session state. With no events yet, the current row is it.
 *
 * This is what makes the server fold idempotent: a re-flush starts
 * from the same place the first flush did.
 */
export function preSessionLiftState(
  current: LiftState,
  sessionEvents: Array<{
    createdAt: string;
    previous: Partial<LiftState> | null;
  }>,
): LiftState {
  const first = [...sessionEvents]
    .filter((e) => e.previous != null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (!first?.previous) return current;
  return {
    ...current,
    e1rmKg: Number(first.previous.e1rmKg ?? current.e1rmKg),
    penalty: Number(first.previous.penalty ?? current.penalty),
    failCount: Number(first.previous.failCount ?? current.failCount),
    hold: Boolean(first.previous.hold ?? current.hold),
    holdAtKg:
      first.previous.holdAtKg === undefined
        ? current.holdAtKg
        : first.previous.holdAtKg,
  };
}
