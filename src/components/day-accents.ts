import type { SessionGroup, SessionStatus } from "@/lib/domain/plan";

/** Colour of the coloured panel / spine for each kind of session. */
export const ACCENT: Record<SessionGroup, string> = {
  strength: "oklch(0.62 0.19 32)",
  run: "oklch(0.62 0.19 250)",
  mobility: "#c9c6bc",
  rest: "#e0ded7",
};

export const TONE = {
  ink: "#111110",
  paper: "#ecebe6",
  mid: "#6e6d67",
  line: "#d7d5cd",
  soft: "#e0ded7",
  ok: "oklch(0.55 0.14 145)",
  warn: "oklch(0.72 0.16 75)",
  fail: "oklch(0.55 0.21 25)",
  tint: "#f2e6cf",
} as const;

export function accentFor(group: SessionGroup): string {
  return ACCENT[group];
}

export const GROUP_LABEL: Record<SessionGroup, string> = {
  strength: "EMPEZAR SESIÓN",
  run: "MARCAR HECHA",
  mobility: "ABRIR MOVILIDAD",
  rest: "DÍA LIBRE",
};

export const STATUS_LABEL: Record<SessionStatus, string> = {
  planned: "PENDIENTE",
  in_progress: "EN CURSO",
  done: "✓ HECHA",
  partial: "PARCIAL",
  skipped: "SALTADA",
};

export function statusTone(status: SessionStatus | null | undefined): string {
  if (status === "done") return "text-ok";
  if (status === "partial") return "text-warn";
  if (status === "skipped") return "text-fail";
  if (status === "in_progress") return "text-strength";
  return "text-mid";
}

/** Colour of a cell in the 12-week consistency grid. */
export function cellColour(
  group: SessionGroup,
  status: SessionStatus | null,
  isFuture: boolean,
): { background: string; border: string } {
  if (group === "rest") return { background: TONE.soft, border: TONE.soft };
  if (isFuture && !status)
    return { background: "transparent", border: "#cdcac1" };
  if (!status || status === "planned" || status === "skipped")
    return { background: TONE.ink, border: "transparent" };
  if (status === "partial")
    return { background: TONE.warn, border: "transparent" };
  return { background: ACCENT[group], border: "transparent" };
}
