"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import {
  ActionBar,
  Callout,
  Footnote,
  RowStack,
  SectionLabel,
} from "@/components/ui/kit";
import { accentFor, TONE } from "@/components/day-accents";
import { enqueueAndFlush } from "@/lib/offline/syncer";
import { cn } from "@/lib/cn";

export interface MobilityItem {
  id: string;
  slug: string;
  groupName: string;
  name: string;
  dose: string;
  doseUnit: string;
  note: string;
}

type Mode = "guided" | "list";

/** Movilidad is its own session group — the quiet accent, never the blue. */
const ACCENT = accentFor("mobility");

export function MobilityBlock({
  items,
  initialCompleted,
  performedOn,
  dateLabel,
}: {
  items: MobilityItem[];
  initialCompleted: string[];
  performedOn: string;
  dateLabel: string;
}) {
  const [mode, setMode] = useState<Mode>("guided");
  const [completed, setCompleted] = useState<string[]>(initialCompleted);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const done = useMemo(() => new Set(completed), [completed]);

  const currentIndex = items.findIndex((i) => !done.has(i.slug));
  const current = currentIndex === -1 ? null : items[currentIndex];
  const next =
    currentIndex === -1
      ? null
      : (items.slice(currentIndex + 1).find((i) => !done.has(i.slug)) ?? null);

  const doneCount = items.filter((i) => done.has(i.slug)).length;
  const allDone = items.length > 0 && doneCount === items.length;

  /** Optimistic locally; the write-ahead queue lands it whenever there is
   *  network. Re-ticks replace the queued op (same natural key), so the
   *  basement gym can tick the whole block without a single bar of signal. */
  function persist(nextSlugs: string[]) {
    setCompleted(nextSlugs);
    setError(null);
    startTransition(async () => {
      await enqueueAndFlush({
        kind: "mobility_log",
        performedOn,
        completedSlugs: nextSlugs,
        totalItems: items.length,
        loggedAt: new Date().toISOString(),
      });
    });
  }

  function toggle(slug: string) {
    const set = new Set(completed);
    if (set.has(slug)) set.delete(slug);
    else set.add(slug);
    // Keep the stored order equal to the block order.
    persist(items.filter((i) => set.has(i.slug)).map((i) => i.slug));
  }

  const completeNote = (
    <Callout eyebrow="Bloque completo" eyebrowTone="text-ok-bright">
      Los <span className="num">{items.length}</span> ejercicios quedan
      registrados el <span className="num">{dateLabel}</span>. Estos 20 minutos
      son innegociables, pero no cuentan como entrenamiento: no suman tonelaje
      ni mueven el motor. Mañana el bloque vuelve a cero.
    </Callout>
  );

  const errorNote = error ? (
    <div className="mx-4 mt-3.5 border-l-[6px] border-fail py-1 pl-3 text-[12px] leading-[1.5]">
      {error}
    </div>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-3 bg-ink px-4 py-3 text-paper">
        <Link
          href="/"
          aria-label="Volver"
          className="flex-none text-[17px] leading-none font-medium"
        >
          ←
        </Link>
        <span className="flex-1 text-[11px] leading-none font-extrabold tracking-[0.1em] uppercase">
          Movilidad
        </span>
        <div className="flex flex-none gap-1.5">
          <ModeChip
            active={mode === "guided"}
            onClick={() => setMode("guided")}
          >
            Guiada
          </ModeChip>
          <ModeChip active={mode === "list"} onClick={() => setMode("list")}>
            Lista
          </ModeChip>
        </div>
      </div>

      {items.length === 0 ? (
        <Footnote>
          No hay ejercicios en el bloque de movilidad. Añádelos desde ajustes
          para que aparezcan aquí cada día.
        </Footnote>
      ) : mode === "guided" ? (
        <>
          {/* One cell per item: hecho, actual, pendiente. */}
          <div className="flex flex-none gap-px bg-paper py-px">
            {items.map((item, i) => (
              <div
                key={item.id}
                className="h-1.5 flex-1"
                style={{
                  background: done.has(item.slug)
                    ? TONE.ok
                    : i === currentIndex
                      ? TONE.ink
                      : TONE.line,
                }}
              />
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {current ? (
              <>
                <section
                  className="px-4 pt-5 pb-6 text-ink"
                  style={{ background: ACCENT }}
                >
                  <div className="flex items-baseline gap-3">
                    <span className="flex-1 text-[11px] leading-none font-extrabold tracking-[0.14em] uppercase">
                      {current.groupName}
                    </span>
                    <span className="num text-[11px] leading-none font-medium opacity-60">
                      {currentIndex + 1}/{items.length}
                    </span>
                  </div>
                  <h1 className="mt-3 text-[31px] leading-[1.02] font-black tracking-[-0.03em]">
                    {current.name}
                  </h1>
                  <div className="mt-4 flex items-start gap-2.5">
                    <div className="num text-[62px] leading-[0.8] font-black tracking-[-0.055em]">
                      {current.dose}
                    </div>
                    {current.doseUnit ? (
                      <div className="max-w-[130px] pt-1.5 text-[15px] leading-[1.15] font-extrabold uppercase">
                        {current.doseUnit}
                      </div>
                    ) : null}
                  </div>
                </section>

                {current.note ? (
                  <p className="px-4 pt-3.5 text-[11.5px] leading-[1.45] text-mid">
                    {current.note}
                  </p>
                ) : null}

                {errorNote}
              </>
            ) : (
              <div className="px-4 pt-5">{completeNote}</div>
            )}
          </div>

          {current ? (
            <>
              <div className="flex-none border-t-2 border-ink px-4 py-3 text-[10px] leading-none font-extrabold tracking-[0.14em] text-mid uppercase">
                {next ? `Siguiente · ${next.name}` : "Último del bloque"}
              </div>
              <ActionBar tone="ink" onClick={() => toggle(current.slug)}>
                {next ? "Hecho" : "Terminar"}
              </ActionBar>
            </>
          ) : null}
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto pb-5">
          <SectionLabel
            right={
              <span className="num">
                {doneCount}/{items.length}
              </span>
            }
          >
            Bloque diario · 20′
          </SectionLabel>

          <RowStack className="mt-2.5">
            {items.map((item) => {
              const checked = done.has(item.slug);
              return (
                <button
                  key={item.id}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggle(item.slug)}
                  className="flex w-full items-center gap-3 bg-paper px-4 py-3 text-left"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-[22px] w-[22px] flex-none items-center justify-center border-2 border-ink",
                      checked ? "bg-ink text-paper" : "bg-transparent",
                    )}
                  >
                    {checked ? (
                      <span className="text-[12px] leading-none font-bold">
                        ✓
                      </span>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-[13.5px] leading-[1.2] font-bold",
                        checked && "text-mid",
                      )}
                    >
                      {item.name}
                    </span>
                    <span className="mt-1 block truncate text-[11px] leading-[1.35] text-mid">
                      {item.groupName}
                    </span>
                  </span>
                  <span className="flex-none text-right">
                    <span className="num block text-[12.5px] leading-none font-extrabold">
                      {item.dose}
                    </span>
                    <span className="mt-1 block text-[9.5px] leading-none font-medium text-mid">
                      {item.doseUnit}
                    </span>
                  </span>
                </button>
              );
            })}
          </RowStack>

          {errorNote}

          {allDone ? (
            <div className="mx-4 mt-3.5">{completeNote}</div>
          ) : (
            <Footnote>
              Quedan <span className="num">{items.length - doneCount}</span> de{" "}
              <span className="num">{items.length}</span>. El bloque se reinicia
              cada día: lo de hoy queda registrado el{" "}
              <span className="num">{dateLabel}</span>.
            </Footnote>
          )}
        </div>
      )}
    </div>
  );
}

/** Chip inverted for the black bar. */
function ModeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "border-2 border-paper px-2.5 py-2 text-[10px] leading-none font-bold tracking-[0.06em] uppercase",
        active ? "bg-paper text-ink" : "bg-transparent text-paper",
      )}
    >
      {children}
    </button>
  );
}
