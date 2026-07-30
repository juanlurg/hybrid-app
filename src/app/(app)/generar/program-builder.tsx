"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ActionBar, Footnote, ScreenHeader, SectionLabel } from "@/components/ui/kit";
import { TONE } from "@/components/day-accents";
import {
  discardGeneratedProgram,
  rebuildProgram,
  type GeneratedPreview,
} from "@/lib/actions/ai";
import { activateProgram } from "@/lib/actions/onboarding";
import { formatDayLong } from "@/lib/domain/calendar";

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
  const [preview, setPreview] = useState<GeneratedPreview | null>(null);
  const [rms, setRms] = useState<Record<string, string>>({});

  /* ── the preview: review, seed RMs, activate explicitly ─────── */
  if (preview) {
    const blocking = preview.phases.flatMap((p) =>
      p.warnings.filter((w) => w.tone === "fail").map((w) => `${p.key}: ${w.title}`),
    );
    const rmsMissing = preview.newLiftKeys.filter((k) => {
      const parsed = Number((rms[k] ?? "").replace(",", "."));
      return !Number.isFinite(parsed) || parsed <= 0;
    });

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ScreenHeader
          eyebrow="Programa generado"
          title={preview.name}
          subtitle={`ARRANCA EL ${formatDayLong(preview.startsOn).toUpperCase()} · AÚN SIN ACTIVAR`}
        />

        <div className="min-h-0 flex-1 overflow-auto">
          <SectionLabel>Fases</SectionLabel>
          <div className="mt-2.5 flex flex-col gap-px bg-line">
            {preview.phases.map((p) => (
              <div key={p.key} className="bg-paper px-4 py-3">
                <div className="flex items-baseline gap-2.5">
                  <span className="text-[13.5px] leading-[1.2] font-bold">
                    {p.key} — {p.name}
                  </span>
                  <span className="num ml-auto text-[11px] leading-none text-mid">
                    {p.weeks} sem
                  </span>
                </div>
                {p.warnings.map((w, i) => (
                  <p
                    key={i}
                    className="mt-2 border-l-4 py-0.5 pl-2.5 text-[11px] leading-[1.45] text-mid"
                    style={{
                      borderColor: w.tone === "fail" ? TONE.fail : TONE.warn,
                    }}
                  >
                    <span className="font-bold">{w.title}.</span> {w.detail}
                  </p>
                ))}
              </div>
            ))}
          </div>

          {preview.newLiftKeys.length > 0 ? (
            <>
              <SectionLabel>RM de los básicos nuevos</SectionLabel>
              <p className="px-4 pt-2 text-[11.5px] leading-[1.5] text-mid">
                El plan sigue {preview.newLiftKeys.length === 1 ? "un básico" : "básicos"}{" "}
                que aún no trackeas. El motor no inventa una RM: pon la tuya
                (vale la estimada con la calculadora de Programa).
              </p>
              <div className="mt-2.5 flex flex-col gap-px bg-line">
                {preview.newLiftKeys.map((k) => (
                  <label
                    key={k}
                    className="flex items-center gap-3 bg-paper px-4 py-3"
                  >
                    <span className="flex-1 text-[13px] leading-[1.2] font-bold capitalize">
                      {k}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={rms[k] ?? ""}
                      placeholder="—"
                      onChange={(e) =>
                        setRms((prev) => ({ ...prev, [k]: e.target.value }))
                      }
                      aria-label={`RM estimada de ${k}`}
                      className="num h-10 w-24 border-2 border-ink bg-paper px-2 text-right text-[15px] font-black outline-none"
                    />
                    <span className="text-[11px] leading-none font-bold text-mid">
                      kg
                    </span>
                  </label>
                ))}
              </div>
            </>
          ) : null}

          {error ? (
            <div className="mx-4 mt-4 border-l-[6px] border-fail py-1 pl-3 text-[12px] leading-[1.5]">
              {error}
            </div>
          ) : null}

          <Footnote>
            Al activar, «{currentProgramName}» queda archivado con todo su
            historial. Puedes reactivarlo cuando quieras desde Ajustes → Datos
            → Programas.
          </Footnote>
        </div>

        <div className="flex flex-none">
          <ActionBar
            tone="strength"
            disabled={pending || blocking.length > 0 || rmsMissing.length > 0}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const seedRms: Record<string, number> = {};
                for (const k of preview.newLiftKeys) {
                  seedRms[k] = Number((rms[k] ?? "").replace(",", "."));
                }
                const res = await activateProgram(preview.programId, seedRms);
                if (!res.ok) {
                  setError(res.error ?? "No se ha podido activar.");
                  return;
                }
                router.push("/programa");
                router.refresh();
              })
            }
          >
            {pending
              ? "…"
              : blocking.length > 0
                ? "El plan tiene fallos de reglas"
                : rmsMissing.length > 0
                  ? "Faltan RM por poner"
                  : "Activar este programa"}
          </ActionBar>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await discardGeneratedProgram(preview.programId);
                setPreview(null);
                setRms({});
              })
            }
            className="flex h-16 w-[110px] items-center justify-center bg-ink text-[12px] leading-none font-bold tracking-[0.06em] text-paper uppercase"
          >
            Descartar
          </button>
        </div>
      </div>
    );
  }

  /* ── the brief ──────────────────────────────────────────────── */
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        eyebrow="Generar programa"
        title="Un plan nuevo, desde cero"
        subtitle="LA IA LO DISEÑA · TÚ LO REVISAS Y ACTIVAS"
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
          Generar no cambia nada todavía: el plan sale sin activar, lo revisas
          y decides. «{currentProgramName}» sigue siendo el activo hasta que tú
          digas.
        </Footnote>
      </div>

      <ActionBar
        tone="strength"
        disabled={!hasApiKey || pending || brief.trim().length < 20}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await rebuildProgram({ brief, startsOn });
            if (!res.ok || !res.preview) {
              setError(res.error ?? "No se ha podido generar el plan.");
              return;
            }
            setPreview(res.preview);
          })
        }
      >
        {pending ? "Diseñando el plan…" : "Generar programa"}
      </ActionBar>
    </div>
  );
}
