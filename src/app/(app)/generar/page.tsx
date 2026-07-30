import { requireAthlete } from "@/lib/data/athlete";
import { hasGeminiKey } from "@/lib/ai/gemini";
import { startOfWeek, todayIso } from "@/lib/domain/calendar";

import { ProgramBuilder } from "./program-builder";

export default async function GenerarPage() {
  const athlete = await requireAthlete();

  return (
    <ProgramBuilder
      hasApiKey={hasGeminiKey()}
      defaultStart={startOfWeek(todayIso())}
      currentProgramName={athlete.ctx.program.name}
      liftNames={athlete.ctx.lifts.map((l) => l.name)}
    />
  );
}
