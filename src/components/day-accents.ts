import type { SessionGroup, SessionStatus } from "@/lib/domain/plan";

/*
 * Inline styles have to follow the theme too, so every value here is the
 * CSS custom property rather than the colour it currently resolves to.
 */

/** Colour of the spine / lit surface for each kind of session. */
export const ACCENT: Record<SessionGroup, string> = {
  strength: "var(--clay-line)",
  run: "var(--run)",
  mobility: "var(--faint)",
  // `soft` is a fill for things sitting ON a card; against the page it
  // disappears in the light theme, which is where rest days live.
  rest: "var(--quiet)",
};

/** `ink` is the foreground colour — never paint a background with it. */
export const TONE = {
  ink: "var(--ink)",
  mid: "var(--mid)",
  line: "var(--line)",
  soft: "var(--soft)",
  quiet: "var(--quiet)",
  hairline: "var(--hairline)",
  ok: "var(--ok)",
  okBright: "var(--ok-bright)",
  warn: "var(--warn)",
  fail: "var(--fail)",
} as const;

export function accentFor(group: SessionGroup): string {
  return ACCENT[group];
}

export const GROUP_LABEL: Record<SessionGroup, string> = {
  strength: "Empezar sesión",
  run: "Marcar hecha",
  mobility: "Abrir movilidad",
  rest: "Día libre",
};

export const STATUS_LABEL: Record<SessionStatus, string> = {
  planned: "Pendiente",
  in_progress: "En curso",
  done: "Hecha",
  partial: "Parcial",
  skipped: "Saltada",
};

export function statusTone(status: SessionStatus | null | undefined): string {
  if (status === "done") return "text-ok";
  if (status === "partial") return "text-warn";
  if (status === "skipped") return "text-fail";
  if (status === "in_progress") return "text-clay";
  return "text-faint";
}

/** Colour of a cell in the 12-week consistency grid. */
export function cellColour(
  group: SessionGroup,
  status: SessionStatus | null,
  isFuture: boolean,
): { background: string; border: string } {
  if (group === "rest") return { background: TONE.soft, border: "transparent" };
  if (isFuture && !status)
    return { background: "transparent", border: TONE.hairline };
  if (!status || status === "planned" || status === "skipped")
    return { background: TONE.hairline, border: "transparent" };
  if (status === "partial")
    return { background: "var(--clay-edge)", border: "transparent" };
  return { background: ACCENT[group], border: "transparent" };
}
