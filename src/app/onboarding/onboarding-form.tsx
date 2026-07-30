"use client";

import { useActionState, useState } from "react";

import {
  completeOnboarding,
  type OnboardingState,
} from "@/lib/actions/onboarding";
import { Alert, Field, SubmitBar } from "@/components/auth/form-bits";
import { cn } from "@/lib/cn";

export interface TemplateOption {
  slug: string;
  name: string;
  goal: string;
  summary: string;
}

export function OnboardingForm({
  templates,
  defaultName,
  defaultStart,
}: {
  templates: TemplateOption[];
  defaultName: string;
  defaultStart: string;
}) {
  const [state, action] = useActionState<OnboardingState, FormData>(
    completeOnboarding,
    {},
  );
  const [selected, setSelected] = useState(templates[0]?.slug ?? "");

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="flex-none bg-ink px-5 py-6 text-paper">
        <div className="mx-auto w-full max-w-xl">
          <div className="text-[11px] leading-none font-extrabold tracking-[0.18em]">
            BLOQUES
          </div>
          <h1 className="mt-4 text-[30px] leading-[1.02] font-black tracking-[-0.03em]">
            Monta tu temporada
          </h1>
          <p className="mt-3 text-[12px] leading-[1.5] opacity-60">
            Elige el plan de partida y dinos cuatro números. Todo lo demás lo
            calcula el motor, y todo se puede cambiar después.
          </p>
        </div>
      </header>

      <form action={action} className="mx-auto w-full max-w-xl flex-1 px-5 py-7">
        <input type="hidden" name="template" value={selected} />

        <div className="text-[10px] leading-none font-extrabold tracking-[0.14em] text-mid uppercase">
          Plan de partida
        </div>
        <div className="mt-3 flex flex-col gap-px bg-line">
          {templates.map((t) => (
            <button
              key={t.slug}
              type="button"
              onClick={() => setSelected(t.slug)}
              className={cn(
                "px-4 py-4 text-left",
                selected === t.slug ? "bg-tint" : "bg-paper",
              )}
            >
              <div className="flex items-baseline gap-3">
                <span className="flex-1 text-[14px] leading-[1.2] font-bold">
                  {t.name}
                </span>
                <span
                  className={cn(
                    "h-4 w-4 flex-none border-2 border-ink",
                    selected === t.slug && "bg-ink",
                  )}
                />
              </div>
              <p className="mt-2 text-[11.5px] leading-[1.45] text-mid">
                {t.goal}
              </p>
            </button>
          ))}
        </div>

        <div className="mt-7 flex flex-col gap-4">
          <Field
            label="Nombre"
            name="display_name"
            defaultValue={defaultName}
            autoComplete="name"
          />
          <Field
            label="Primer lunes del plan"
            name="starts_on"
            type="date"
            defaultValue={defaultStart}
            required
            hint="El plan se desplaza en bloque; la estructura no cambia."
          />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="LTHR"
              name="lthr"
              type="number"
              min={100}
              max={230}
              placeholder="168"
              hint="Si no lo sabes, déjalo vacío: el test cae en la semana 4."
            />
            <Field
              label="Peso corporal"
              name="body_weight_kg"
              type="text"
              inputMode="decimal"
              placeholder="80"
              hint="kg"
            />
          </div>
        </div>

        {state.error ? (
          <div className="mt-5">
            <Alert tone="error">{state.error}</Alert>
          </div>
        ) : null}

        <div className="mt-7">
          <SubmitBar pendingLabel="Montando el plan…">Empezar</SubmitBar>
        </div>

        <p className="mt-5 text-[11px] leading-[1.55] text-faint">
          Las RM de partida vienen del plan y son una estimación. Corrígelas en
          Programa antes de la primera sesión pesada: son lo que el motor usa
          para calcular cada peso.
        </p>
      </form>
    </div>
  );
}
