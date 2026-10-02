"use client";

import { Calendar, CircleAlert, Sparkles, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  ActionBar,
  Card,
  Footnote,
  Row,
  RowStack,
  ScreenHeader,
  SectionLabel,
  TopBar,
} from "@/components/ui/kit";
import {
  discardGeneratedProgram,
  rebuildProgram,
  type GeneratedPreview,
} from "@/lib/actions/ai";
import { activateProgram } from "@/lib/actions/onboarding";
import { formatDayFull } from "@/lib/domain/calendar";
import { cn } from "@/lib/cn";

const EXAMPLES = [
  "Media maratón en 5 meses. Cinco días a la semana, gimnasio en casa con barra y rack. Quiero mantener el físico y bajar de 1h45.",
  "Vuelvo de una lesión de sóleo. Ocho semanas: reconstruir base aeróbica sin impacto alto y mantener fuerza de tren superior.",
  "Bloque de fuerza puro de 12 semanas. Cuatro días, sin carrera salvo un rodaje suelto el domingo.",
];

function ErrorNote({ children }: { children: string }) {
  return (
    <div className="mx-5 mt-4 flex items-start gap-2.5 rounded-2xl bg-fail-soft px-4 py-3 text-[13px] leading-[1.45] font-medium text-fail">
      <CircleAlert aria-hidden size={16} className="mt-0.5 flex-none" />
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

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
        <TopBar title="Generar programa" href="/programa" />
        <ScreenHeader
          className="pt-2"
          eyebrow="Programa generado"
          title={preview.name}
        >
          <div className="mt-2.5 flex">
            <span className="flex h-7 items-center gap-1.5 rounded-full bg-warn-soft px-3 text-[12.5px] leading-none font-bold">
              <span className="h-1.5 w-1.5 rounded-full bg-warn-dot" />
              {`Arranca el ${formatDayFull(preview.startsOn).toLowerCase()} · aún sin activar`}
            </span>
          </div>
        </ScreenHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          <SectionLabel
            right={
              <span className="num">
                {preview.phases.reduce((n, p) => n + p.weeks, 0)} semanas
              </span>
            }
          >
            Fases
          </SectionLabel>
          <RowStack className="mt-2.5">
            {preview.phases.map((p) => (
              <Row key={p.key}>
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-soft text-[12px] leading-none font-extrabold text-body">
                    {p.key}
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] leading-[1.25] font-bold">
                    {p.name}
                  </span>
                  <span className="num flex-none text-[13px] leading-none font-bold text-body">
                    {p.weeks} sem
                  </span>
                </div>
                {p.warnings.map((w, i) => (
                  <div
                    key={i}
                    className={cn(
                      "mt-2.5 ml-12 flex gap-2.5 rounded-lg px-3 py-2.5",
                      w.tone === "fail" ? "bg-fail-soft" : "bg-warn-soft",
                    )}
                  >
                    <TriangleAlert
                      aria-hidden
                      size={15}
                      className={cn(
                        "mt-px flex-none",
                        w.tone === "fail" ? "text-fail" : "text-clay-dim",
                      )}
                    />
                    <p className="min-w-0 flex-1 text-[12.5px] leading-[1.45] font-medium text-body">
                      <span className="font-bold text-ink">{w.title}.</span>{" "}
                      {w.detail}
                    </p>
                  </div>
                ))}
              </Row>
            ))}
          </RowStack>

          {preview.newLiftKeys.length > 0 ? (
            <>
              <SectionLabel>RM de los básicos nuevos</SectionLabel>
              <p className="px-6 pt-2 text-[13px] leading-[1.5] font-medium text-body">
                El plan sigue {preview.newLiftKeys.length === 1 ? "un básico" : "básicos"}{" "}
                que aún no trackeas. El motor no inventa una RM: pon la tuya
                (vale la estimada con la calculadora de Programa).
              </p>
              <div className="mx-5 mt-2.5 flex flex-col gap-2">
                {preview.newLiftKeys.map((k) => (
                  <label
                    key={k}
                    className="flex items-center gap-3 rounded-2xl bg-surface py-3 pr-3 pl-4 shadow-card"
                  >
                    <span className="min-w-0 flex-1 text-[15px] leading-[1.25] font-bold capitalize">
                      {k}
                    </span>
                    <span className="flex h-11 w-24 flex-none items-center gap-1.5 rounded-lg border-2 border-clay bg-soft px-3.5">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={rms[k] ?? ""}
                        placeholder="—"
                        onChange={(e) =>
                          setRms((prev) => ({ ...prev, [k]: e.target.value }))
                        }
                        aria-label={`RM estimada de ${k}`}
                        className="num h-full w-full min-w-0 bg-transparent text-right text-[16px] font-extrabold outline-none"
                      />
                      <span className="text-[13px] leading-none font-bold text-mid">
                        kg
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          ) : null}

          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <Footnote>
            Al activar, «{currentProgramName}» queda archivado con todo su
            historial. Puedes reactivarlo cuando quieras desde Ajustes → Datos
            → Programas.
          </Footnote>
        </div>

        <div className="flex flex-none items-stretch">
          <ActionBar
            tone="strength"
            className="min-w-0 flex-1 pr-2.5"
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
          <div className="flex-none pt-3.5 pr-4 pb-3">
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
              className="flex h-14 items-center justify-center rounded-xl bg-surface px-[18px] text-[14px] leading-none font-bold text-body shadow-raised disabled:opacity-40"
            >
              Descartar
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── the brief ──────────────────────────────────────────────── */
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar title="Generar programa" href="/programa" />
      <ScreenHeader
        className="pt-2"
        eyebrow="Otra temporada"
        title="Un plan nuevo, desde cero"
        subtitle={
          <>
            Describe el objetivo, la fecha, cuántos días puedes entrenar y qué
            material tienes. La IA monta las fases, la semana tipo y las
            prescripciones de carrera. Las RM que ya sigues se conservan —{" "}
            {liftNames.length > 0 ? liftNames.join(", ") : "las que vayas creando"} —
            porque el motor de pesos es tuyo, no del plan.
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto">
        {!hasApiKey ? (
          <div className="mx-5 mt-4 flex items-start gap-2.5 rounded-2xl bg-warn-soft px-4 py-3 text-[13px] leading-[1.45] font-medium text-body">
            <TriangleAlert
              aria-hidden
              size={16}
              className="mt-0.5 flex-none text-clay-dim"
            />
            <span className="min-w-0 flex-1">
              Falta <code className="font-bold text-ink">GEMINI_API_KEY</code> en{" "}
              <code className="font-bold text-ink">.env.local</code>. Sin ella no
              se puede generar un plan; el editor manual sigue funcionando.
            </span>
          </div>
        ) : null}

        <SectionLabel>El encargo</SectionLabel>
        <Card className="mx-5 mt-2.5 rounded-2xl px-4 py-3.5">
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={5}
            disabled={!hasApiKey || pending}
            placeholder="Ej: media maratón el 25 de abril, cinco días a la semana, rack y barra en casa…"
            aria-label="Descripción del programa"
            className="block w-full resize-none bg-transparent text-[14.5px] leading-[1.55] font-medium outline-none disabled:opacity-50"
          />
        </Card>

        <div className="mx-5 mt-2.5 flex flex-col gap-1.5">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              disabled={!hasApiKey || pending}
              onClick={() => setBrief(e)}
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left shadow-raised disabled:opacity-40",
                brief === e ? "bg-clay-soft" : "bg-surface",
              )}
            >
              <Sparkles aria-hidden size={14} className="flex-none text-clay" />
              <span className="min-w-0 flex-1 text-[13px] leading-[1.4] font-medium text-body">
                {e.slice(0, 40)}…
              </span>
            </button>
          ))}
        </div>

        <SectionLabel>Primer lunes</SectionLabel>
        <label className="mx-5 mt-2.5 flex h-13 items-center gap-2.5 rounded-xl bg-surface px-4 shadow-raised">
          <Calendar aria-hidden size={18} className="flex-none text-mid" />
          <input
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            disabled={pending}
            aria-label="Fecha de inicio"
            className="num h-full min-w-0 flex-1 bg-transparent text-[14.5px] font-bold outline-none"
          />
        </label>

        {error ? <ErrorNote>{error}</ErrorNote> : null}

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
        {pending ? (
          "Diseñando el plan…"
        ) : (
          <>
            <Sparkles aria-hidden size={18} />
            Generar programa
          </>
        )}
      </ActionBar>
    </div>
  );
}
