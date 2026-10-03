import { Dumbbell, Footprints, Leaf, Moon, type LucideProps } from "lucide-react";

import type { SessionGroup } from "@/lib/domain/plan";

const ICON = {
  strength: Dumbbell,
  run: Footprints,
  mobility: Leaf,
  rest: Moon,
} as const;

/** The one glyph per kind of day, wherever a day is drawn. */
export function DayIcon({
  group,
  ...props
}: { group: SessionGroup } & LucideProps) {
  const Icon = ICON[group];
  return <Icon aria-hidden size={18} strokeWidth={2} {...props} />;
}
