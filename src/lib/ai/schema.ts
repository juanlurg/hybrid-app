import { z } from "zod";

/**
 * The contract between the model and the plan.
 *
 * Deliberately flat: one object shape with an `op` discriminator and
 * optional fields, rather than a discriminated union. Structured output
 * is far more reliable against a flat schema, and the refinement below
 * gives back the same guarantees before anything touches the database.
 *
 * Note what is NOT here: nothing that can write to `lifts`. The model
 * can restructure the plan; it cannot move an athlete's RM.
 */

export const CHANGE_OPS = [
  "remove_exercise",
  "add_exercise",
  "move_exercise",
  "rename_exercise",
  "set_sets",
  "set_reps",
  "set_rest",
  "set_day_slot",
  "set_wave",
  "note",
] as const;

export type ChangeOpKind = (typeof CHANGE_OPS)[number];

export const changeOpSchema = z
  .object({
    op: z.enum(CHANGE_OPS),
    /** Short imperative headline for the diff card. */
    title: z.string().min(1).max(120),
    /** What it is today. Rendered struck through. */
    from: z.string().max(160).default(""),
    /** What it becomes. */
    to: z.string().max(160).default(""),
    /** The reasoning. Shown under the card; keep it to one or two sentences. */
    why: z.string().max(400).default(""),

    exerciseId: z.string().uuid().nullish(),
    slotId: z.string().uuid().nullish(),
    targetSlotId: z.string().uuid().nullish(),

    name: z.string().max(120).nullish(),
    sets: z.number().int().min(1).max(12).nullish(),
    repMin: z.number().int().min(1).max(100).nullish(),
    repMax: z.number().int().min(1).max(100).nullish(),
    restSeconds: z.number().int().min(0).max(600).nullish(),
    dayIndex: z.number().int().min(0).max(6).nullish(),
    waveIndex: z.number().int().min(0).max(7).nullish(),
    waveValue: z.number().min(0.5).max(1).nullish(),
  })
  .superRefine((op, ctx) => {
    const needsExercise: ChangeOpKind[] = [
      "remove_exercise",
      "move_exercise",
      "rename_exercise",
      "set_sets",
      "set_reps",
      "set_rest",
    ];
    const fail = (message: string) =>
      ctx.addIssue({ code: "custom", message, path: ["op"] });

    if (needsExercise.includes(op.op) && !op.exerciseId) {
      fail(`${op.op} necesita exerciseId`);
    }
    if (op.op === "add_exercise" && (!op.slotId || !op.name)) {
      fail("add_exercise necesita slotId y name");
    }
    if (op.op === "move_exercise" && !op.targetSlotId) {
      fail("move_exercise necesita targetSlotId");
    }
    if (op.op === "rename_exercise" && !op.name) {
      fail("rename_exercise necesita name");
    }
    if (op.op === "set_sets" && op.sets == null) fail("set_sets necesita sets");
    if (op.op === "set_reps" && (op.repMin == null || op.repMax == null)) {
      fail("set_reps necesita repMin y repMax");
    }
    if (op.op === "set_reps" && op.repMin != null && op.repMax != null) {
      if (op.repMax < op.repMin) fail("El rango de reps está invertido");
    }
    if (op.op === "set_rest" && op.restSeconds == null) {
      fail("set_rest necesita restSeconds");
    }
    if (op.op === "set_day_slot" && (op.dayIndex == null || !op.slotId)) {
      fail("set_day_slot necesita dayIndex y slotId");
    }
    if (op.op === "set_wave" && (op.waveIndex == null || op.waveValue == null)) {
      fail("set_wave necesita waveIndex y waveValue");
    }
  });

export type ChangeOp = z.infer<typeof changeOpSchema>;

export const proposalSchema = z.object({
  /** The coach's answer, in prose. Shown as the assistant message. */
  rationale: z.string().min(1).max(1600),
  changes: z.array(changeOpSchema).max(12).default([]),
});

export type Proposal = z.infer<typeof proposalSchema>;

/**
 * JSON Schema handed to Gemini. Written out rather than derived so the
 * wording of each description is tuned for the model — those strings do
 * most of the work of keeping proposals sane.
 */
export const PROPOSAL_JSON_SCHEMA = {
  type: "object",
  properties: {
    rationale: {
      type: "string",
      description:
        "Tu respuesta al atleta, en español, 2-5 frases. Explica el criterio, no el listado de cambios. Tono directo, sin exclamaciones ni emoji.",
    },
    changes: {
      type: "array",
      description:
        "Los cambios concretos que propones. Como mucho 6. Vacío si la pregunta no requiere tocar el plan.",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: [...CHANGE_OPS] },
          title: {
            type: "string",
            description:
              "Titular corto del cambio, en español. Ej: 'Quitar press inclinado'.",
          },
          from: {
            type: "string",
            description: "Estado actual, corto. Ej: '3 × 8-10 en Fuerza B'.",
          },
          to: {
            type: "string",
            description: "Estado propuesto, corto. Ej: 'fuera'.",
          },
          why: {
            type: "string",
            description:
              "Una o dos frases con el porqué fisiológico o de programación.",
          },
          exerciseId: {
            type: "string",
            description:
              "UUID exacto del ejercicio, copiado del plan que te doy.",
          },
          slotId: {
            type: "string",
            description: "UUID exacto de la sesión (slot) del plan.",
          },
          targetSlotId: {
            type: "string",
            description: "UUID de la sesión destino, sólo para move_exercise.",
          },
          name: { type: "string" },
          sets: { type: "integer" },
          repMin: { type: "integer" },
          repMax: { type: "integer" },
          restSeconds: { type: "integer" },
          dayIndex: {
            type: "integer",
            description: "0 = lunes … 6 = domingo.",
          },
          waveIndex: {
            type: "integer",
            description: "Posición en la ola, 0 = primera semana del ciclo.",
          },
          waveValue: {
            type: "number",
            description: "Multiplicador, entre 0.5 y 1. Ej: 0.88 para 88 %.",
          },
        },
        required: ["op", "title", "from", "to", "why"],
      },
    },
  },
  required: ["rationale", "changes"],
} as const;

/* ── whole-program generation ────────────────────────────────── */

export const generatedProgramSchema = z.object({
  name: z.string().min(1).max(120),
  goal: z.string().max(400).default(""),
  summary: z.string().max(800).default(""),
  wave: z.array(z.number().min(0.5).max(1)).min(2).max(8),
  phases: z
    .array(
      z.object({
        key: z.string().min(1).max(8),
        name: z.string().min(1).max(80),
        emphasis: z.string().max(160).default(""),
        weeks: z.number().int().min(1).max(24),
        notes: z.string().max(600).default(""),
        slots: z
          .array(
            z.object({
              key: z.string().min(1).max(12),
              sessionType: z.enum([
                "strength",
                "run_quality",
                "run_long",
                "run_easy",
                "run_test",
                "mobility",
                "rest",
              ]),
              label: z.string().min(1).max(24),
              title: z.string().min(1).max(60),
              subtitle: z.string().max(120).default(""),
              exercises: z
                .array(
                  z.object({
                    name: z.string().min(1).max(120),
                    sets: z.number().int().min(1).max(12),
                    repMin: z.number().int().min(1).max(100),
                    repMax: z.number().int().min(1).max(100),
                    restSeconds: z.number().int().min(0).max(600),
                    isPrimary: z.boolean().default(false),
                    liftKey: z.string().max(40).nullish(),
                    notes: z.string().max(240).default(""),
                  }),
                )
                .max(12)
                .default([]),
            }),
          )
          .min(1)
          .max(10),
        days: z
          .array(
            z.object({
              dayIndex: z.number().int().min(0).max(6),
              slotKey: z.string().min(1).max(12),
            }),
          )
          .length(7),
        runs: z
          .array(
            z.object({
              slotKey: z.string().min(1).max(12),
              week: z.number().int().min(1).max(24),
              prescription: z.string().min(1).max(200),
              targetMinutes: z.number().int().min(0).max(600).nullish(),
              notes: z.string().max(240).default(""),
            }),
          )
          .max(200)
          .default([]),
      }),
    )
    .min(1)
    .max(8),
});

export type GeneratedProgram = z.infer<typeof generatedProgramSchema>;

export const PROGRAM_JSON_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    goal: { type: "string" },
    summary: { type: "string" },
    wave: {
      type: "array",
      description:
        "Multiplicadores de la ola, uno por semana del ciclo. Ej: [0.75, 0.8, 0.85, 0.7]. El último es la descarga.",
      items: { type: "number" },
    },
    phases: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string", description: "F0, F1, F2…" },
          name: { type: "string" },
          emphasis: { type: "string" },
          weeks: { type: "integer" },
          notes: { type: "string" },
          slots: {
            type: "array",
            description:
              "Las sesiones tipo de la fase. Una por cada clase de día distinta.",
            items: {
              type: "object",
              properties: {
                key: {
                  type: "string",
                  description: "Identificador corto: A, B, C, run, long, mov, off.",
                },
                sessionType: {
                  type: "string",
                  enum: [
                    "strength",
                    "run_quality",
                    "run_long",
                    "run_easy",
                    "run_test",
                    "mobility",
                    "rest",
                  ],
                },
                label: { type: "string", description: "FUERZA A" },
                title: { type: "string", description: "Fuerza A" },
                subtitle: { type: "string" },
                exercises: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      sets: { type: "integer" },
                      repMin: { type: "integer" },
                      repMax: { type: "integer" },
                      restSeconds: { type: "integer" },
                      isPrimary: {
                        type: "boolean",
                        description:
                          "El básico del día. Exactamente uno por sesión de fuerza.",
                      },
                      liftKey: {
                        type: "string",
                        description:
                          "Sólo para básicos con RM seguida: sentadilla, banca, hipthrust, militar, rdl.",
                      },
                      notes: { type: "string" },
                    },
                    required: [
                      "name",
                      "sets",
                      "repMin",
                      "repMax",
                      "restSeconds",
                      "isPrimary",
                    ],
                  },
                },
              },
              required: ["key", "sessionType", "label", "title", "exercises"],
            },
          },
          days: {
            type: "array",
            description: "Exactamente 7, de lunes (0) a domingo (6).",
            items: {
              type: "object",
              properties: {
                dayIndex: { type: "integer" },
                slotKey: { type: "string" },
              },
              required: ["dayIndex", "slotKey"],
            },
          },
          runs: {
            type: "array",
            description:
              "Una entrada por sesión de carrera y semana de la fase.",
            items: {
              type: "object",
              properties: {
                slotKey: { type: "string" },
                week: { type: "integer" },
                prescription: { type: "string" },
                targetMinutes: { type: "integer" },
                notes: { type: "string" },
              },
              required: ["slotKey", "week", "prescription"],
            },
          },
        },
        required: ["key", "name", "weeks", "slots", "days"],
      },
    },
  },
  required: ["name", "wave", "phases"],
} as const;
