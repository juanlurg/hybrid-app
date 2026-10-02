import { formatWeight } from "@/lib/engine";

/*
 * One side of the bar, drawn: sleeve stub, the plates from heaviest in,
 * then the collar. Bigger plates are taller and warmer, so the heavy
 * end of the load reads before the numbers do.
 */
const HEIGHT: Record<string, number> = {
  "25": 44,
  "20": 40,
  "15": 36,
  "10": 31,
  "5": 24,
  "2.5": 19,
  "1.25": 15,
};

function plateColour(kg: number, onPanel: boolean): string {
  if (kg >= 25) return onPanel ? "var(--plate-25)" : "var(--clay-dim)";
  if (kg >= 20) return onPanel ? "var(--plate-20)" : "var(--clay-line)";
  if (kg >= 15) return onPanel ? "var(--plate-15)" : "#d76e3f";
  if (kg >= 10) return onPanel ? "color-mix(in srgb, var(--on-panel) 85%, transparent)" : "var(--panel)";
  if (kg >= 5) return onPanel ? "color-mix(in srgb, var(--on-panel) 60%, transparent)" : "var(--faint)";
  if (kg >= 2.5) return onPanel ? "color-mix(in srgb, var(--on-panel) 45%, transparent)" : "var(--ghost)";
  return onPanel
    ? "color-mix(in srgb, var(--on-panel) 30%, transparent)"
    : "var(--hairline)";
}

export function PlateBar({
  perSide,
  onPanel = false,
  scale = 1,
}: {
  perSide: number[];
  onPanel?: boolean;
  scale?: number;
}) {
  const bar = onPanel ? "color-mix(in srgb, var(--on-panel) 30%, transparent)" : "var(--ghost)";
  return (
    <div
      aria-hidden
      className="flex items-center gap-[3px]"
      style={{ height: 44 * scale }}
    >
      <span
        className="rounded-[2px]"
        style={{ width: 5 * scale, height: 8 * scale, background: bar }}
      />
      {perSide.map((kg, i) => (
        <span
          key={i}
          className="rounded-[3px]"
          style={{
            width: 8 * scale,
            height: (HEIGHT[String(kg)] ?? 15) * scale,
            background: plateColour(kg, onPanel),
          }}
        />
      ))}
      <span
        className="rounded-[2px]"
        style={{ width: 16 * scale, height: 6 * scale, background: bar }}
      />
    </div>
  );
}

/** "20 + 20 + 10 por lado" */
export function perSideLabel(perSide: number[]): string {
  return `${perSide.map((p) => formatWeight(p)).join(" + ")} por lado`;
}
