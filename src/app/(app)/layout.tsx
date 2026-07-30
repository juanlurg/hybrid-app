import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { requireAthlete } from "@/lib/data/athlete";
import { formatSeasonRange } from "@/lib/domain/calendar";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const athlete = await requireAthlete();
  const { program } = athlete.ctx;
  const season =
    program.starts_on && program.ends_on
      ? formatSeasonRange(program.starts_on, program.ends_on).toUpperCase()
      : undefined;

  return <AppShell seasonLabel={season}>{children}</AppShell>;
}
