/**
 * The wire contract of /api/sync, shared between the route (parsing)
 * and the queue tests (proving every envelope buildEnvelopes can emit
 * actually validates). One schema, one truth — a queue the client can
 * build but the server rejects is exactly the bug this file prevents.
 */

import { z } from "zod";

export const sessionKeySchema = z.object({
  phaseId: z.string().uuid(),
  slotId: z.string().uuid(),
  scheduledOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  week: z.number().int().min(1).max(60),
  dayIndex: z.number().int().min(0).max(6),
  sessionType: z.enum([
    "strength", "run_quality", "run_long", "run_easy", "run_test",
    "mobility", "rest",
  ]),
  title: z.string().max(200),
});

/**
 * Envelopes built after the session_start op was acked carry no key.
 * Clients from before key hydration sent an empty placeholder instead —
 * coerce it to null so their queues drain after a deploy.
 */
const nullableKeySchema = z.preprocess(
  (raw) =>
    raw != null &&
    typeof raw === "object" &&
    (raw as { phaseId?: unknown }).phaseId === ""
      ? null
      : raw,
  sessionKeySchema.nullable(),
);

export const setSchema = z.object({
  programExerciseId: z.string().uuid(),
  liftKey: z.string().max(60).nullable(),
  exerciseName: z.string().max(200),
  position: z.number().int().min(0).max(50),
  setIndex: z.number().int().min(0).max(30),
  reps: z.number().int().min(0).max(200).nullable(),
  seconds: z.number().int().min(0).max(600).nullable(),
  rir: z.number().min(0).max(10).nullable(),
  weightKg: z.number().min(0).max(1000).nullable(),
  loggedAt: z.string(),
});

export const sessionEnvelopeSchema = z.object({
  localSessionId: z.string().uuid(),
  key: nullableKeySchema,
  startedAt: z.string().nullable(),
  sets: z.array(setSchema).max(200),
  undoneFailures: z
    .array(z.object({ position: z.number().int(), setIndex: z.number().int() }))
    .max(50),
  // Optional-with-default so queues from clients built before the field
  // existed still drain after a deploy — same protocolVersion.
  unlogs: z
    .array(z.object({ position: z.number().int(), setIndex: z.number().int() }))
    .max(50)
    .optional()
    .default([]),
  finish: z
    .object({
      finishedAt: z.string(),
      notes: z.string().max(2000).nullish(),
    })
    .nullable(),
  opKeys: z.array(z.string().max(200)).max(300),
});

export const syncRequestSchema = z.object({
  protocolVersion: z.literal(1),
  deviceId: z.string().max(100),
  sessions: z.array(sessionEnvelopeSchema).max(30),
  runLogs: z
    .array(
      z.object({
        key: sessionKeySchema,
        prescription: z.string().max(400),
        durationMinutes: z.number().min(0).max(1000).nullable(),
        distanceKm: z.number().min(0).max(500).nullable(),
        avgHr: z.number().int().min(0).max(250).nullable(),
        decouplingPct: z.number().min(-50).max(50).nullable(),
        perceivedEffort: z.number().int().min(1).max(10).nullish(),
        notes: z.string().max(2000),
        opKey: z.string().max(200),
      }),
    )
    .max(60),
  mobilityLogs: z
    .array(
      z.object({
        performedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        completedSlugs: z.array(z.string().max(100)).max(60),
        totalItems: z.number().int().min(0).max(100),
        opKey: z.string().max(200),
      }),
    )
    .max(60),
});
