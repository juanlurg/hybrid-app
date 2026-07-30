"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ActionBar, Footnote, ScreenHeader, SectionLabel } from "@/components/ui/kit";
import { rebuildProgram } from "@/lib/actions/ai";

const EXAMPLES = [
  "Media maratón en 5 meses. Cinco días a la semana, gimnasio en casa con barra y rack. Quiero mantener el físico y bajar de 1h45.",
  "Vuelvo de una lesión de sóleo. Ocho semanas: reconstruir base aeróbica sin impacto alto y mantener fuerza de tren superior.",
  "Bloque de fuerza puro de 12 semanas. Cuatro días, sin carrera salvo un rodaje suelto el domingo.",
];

export function ProgramBuilder({
  hasApiKey,
  defaultStart,
  currentProgramName,
  liftNames,
}: {
  hasApiKey: boolean;
  defaultStart: string;
  currentProgramName: string;
  liftNames: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [brief, setBrief] = useState("");
  const [startsOn, setStartsOn] = useState(defaultStart);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        eyebrow="Generar programa"
        title="Un plan nuevo, desde cero"
        subtitle="LA IA LO DISEÑA · TÚ LO EDITAS DESPUÉS"
      />

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="px-4 pt-5">
          <p className="text-[12.5px] leading-[1.55] text-mid">
            Describe el objetivo, la fecha, cuántos días puedes entrenar y qué
            material tienes. La IA monta las fases, la semana tipo y las
            prescripciones de carrera. Las RM que ya sigues se conservan
            —{" "}
            {liftNames.length > 0 ? liftNames.join(", ") : "las que vayas creando"} —
            porque el motor de pesos es tuyo, no del plan.
          </p>
        </div>

        {!hasApiKey ? (
          <div className="mx-4 mt-4 border-l-[6px] border-warn py-1 pl-3 text-[12px] leading-[1.55]">
            Falta <code className="font-bold">GEMINI_API_KEY</code> en{" "}
            <code className="font-bold">.env.local</code>. Sin ella no se puede
            generar un plan; el editor manual sigue funcionando.
          </div>
        ) : null}

        <SectionLabel>El encargo</SectionLabel>
        <div className="mx-4 mt-3">
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={6}
            disabled={!hasApiKey || pending}
            placeholder="Ej: media maratón el 25 de abril, cinco días a la semana, rack y barra en casa…"
            aria-label="Descripción del programa"
            className="w-full border-2 border-ink bg-paper px-3 py-3 text-[13px] leading-[1.5] outline-none disabled:opacity-50"
          />
        </div>

        <div className="mx-4 mt-3 flex flex-wrap gap-1">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              disabled={!hasApiKey || pending}
              onClick={() => setBrief(e)}
              className="border-2 border-ink px-2.5 py-2 text-left text-[10.5px] leading-[1.3] font-semibold disabled:opacity-40"
            >
              {e.slice(0, 40)}…
            </button>
          ))}
        </div>

        <SectionLabel>Primer lunes</SectionLabel>
        <div className="mx-4 mt-3">
          <input
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            disabled={pending}
            aria-label="Fecha de inicio"
            className="h-12 w-full border-2 border-ink bg-paper px-3 text-[14px] font-medium outline-none"
          />
        </div>

        {error ? (
          <div className="mx-4 mt-4 border-l-[6px] border-fail py-1 pl-3 text-[12px] leading-[1.5]">
            {error}
          </div>
        ) : null}

        <Footnote>
          Al generar, «{currentProgramName}» se archiva y el plan nuevo pasa a ser
          el activo. El historial de sesiones no se borra. Puedes volver al
          anterior desde Ajustes.
        </Footnote>
      </div>

      <ActionBar
        tone="strength"
        disabled={!hasApiKey || pending || brief.trim().length < 20}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await rebuildProgram({ brief, startsOn });
            if (!res.ok) {
              setError(res.error ?? "No se ha podido generar el plan.");
              return;
            }
            router.push("/programa");
            router.refresh();
          })
        }
      >
        {pending ? "Diseñando el plan…" : "Generar programa"}
      </ActionBar>
    </div>
  );
}
