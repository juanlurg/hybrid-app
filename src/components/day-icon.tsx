import {
  Bike,
  Dumbbell,
  Footprints,
  Leaf,
  Moon,
  type LucideProps,
} from "lucide-react";

import type { SessionGroup, SessionType } from "@/lib/domain/plan";

const ICON = {
  strength: Dumbbell,
  run: Footprints,
  mobility: Leaf,
  rest: Moon,
} as const;

/**
 * The one glyph per kind of day, wherever a day is drawn. Aerobic work
 * that is not running shares running's colour, not its footprints.
 */
export function DayIcon({
  group,
  type,
  ...props
}: { group: SessionGroup; type?: SessionType } & LucideProps) {
  const Icon = type === "cross" ? Bike : ICON[group];
  return <Icon aria-hidden size={18} strokeWidth={2} {...props} />;
}
