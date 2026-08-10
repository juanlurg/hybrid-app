"use client";

import { useMemo, useState, useTransition } from "react";

import {
  ActionBar,
  Callout,
  Card,
  Chip,
  Footnote,
  RowStack,
  SectionLabel,
  TopBar,
} from "@/components/ui/kit";
import { TONE } from "@/components/day-accents";
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

/* The mode chips ride inside the top bar, so they run a size below the kit's
   default and the inactive one recedes into the surface. */
const modeChip = "px-3 py-2.5 text-[10.5px] font-bold uppercase";
const inactiveChip = "bg-surface font-semibold text-mid";

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
    <div className="mx-5 mt-3.5 rounded-r-sm border-l-[4px] border-fail py-1 pl-3 text-[12px] leading-[1.5]">
      {error}
    </div>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        title="Movilidad"
        href="/"
        right={
          <span className="flex gap-1">
            <Chip
              active={mode === "guided"}
              aria-pressed={mode === "guided"}
              onClick={() => setMode("guided")}
              className={cn(modeChip, mode !== "guided" && inactiveChip)}
            >
              Guiada
            </Chip>
            <Chip
              active={mode === "list"}
              aria-pressed={mode === "list"}
              onClick={() => setMode("list")}
              className={cn(modeChip, mode !== "list" && inactiveChip)}
            >
              Lista
            </Chip>
          </span>
        }
      />

      {items.length === 0 ? (
        <Footnote>
          No hay ejercicios en el bloque de movilidad. Añádelos desde ajustes
          para que aparezcan aquí cada día.
        </Footnote>
      ) : mode === "guided" ? (
        <>
          {/* One cell per item: hecho, actual, pendiente. The current cell is
              the foreground colour on purpose — it is the only thing on the
              strip that has to read as "you are here". */}
          <div className="flex flex-none gap-1 px-5 pt-2">
            {items.map((item, i) => (
              <div
                key={item.id}
                className="h-1.5 flex-1 rounded-full"
                style={{
                  background: done.has(item.slug)
                    ? TONE.ok
                    : i === currentIndex
                      ? TONE.ink
                      : TONE.soft,
                }}
              />
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {current ? (
              <>
                <section className="px-5 pt-5">
                  <Card>
                    <div className="flex items-baseline gap-3">
                      <span className="font-display min-w-0 flex-1 truncate text-[11px] leading-none font-semibold tracking-[0.14em] text-mid uppercase">
                        {current.groupName}
                      </span>
                      <span className="num flex-none text-[11px] leading-none text-faint">
                        {currentIndex + 1}/{items.length}
                      </span>
                    </div>

                    <h1 className="font-display mt-2.5 text-[23px] leading-[1.2] font-bold">
                      {current.name}
                    </h1>

                    {/* The dose is the lit thing: the reps, or the seconds of
                        a hold. It is free text — "45" but also "2 × 15" — so
                        the display size only holds from the 390 px the design
                        assumes, and the unit is capped narrow so it stacks
                        beside the figure instead of running to the card edge. */}
                    <div className="mt-3.5 flex items-baseline gap-2.5">
                      <span className="num flex-none text-[58px] leading-[0.95] font-bold tracking-[-0.02em] text-lime min-[390px]:text-[76px]">
                        {current.dose}
                      </span>
                      {current.doseUnit ? (
                        <span className="font-display max-w-[104px] min-w-0 flex-1 text-[15px] leading-[1.3] font-semibold text-mid uppercase">
                          {current.doseUnit}
                        </span>
                      ) : null}
                    </div>

                    {current.note ? (
                      <p className="mt-4 border-t border-edge pt-3 text-[12.5px] leading-[1.55] text-mid">
                        {current.note}
                      </p>
                    ) : null}
                  </Card>

                  <div className="mt-4 flex items-center gap-2.5 px-1">
                    <span className="font-display flex-none text-[11px] leading-none font-semibold tracking-[0.12em] text-faint uppercase">
                      {next ? "Siguiente" : "Último"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px] leading-[1.2] font-medium">
                      {next ? next.name : "del bloque"}
                    </span>
                    {next ? (
                      <span className="num flex-none text-[13px] leading-none text-mid">
                        {next.dose}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-4 px-1 text-[11.5px] leading-[1.55] text-faint">
                    <span className="num">20′</span> diarios. Innegociable, pero
                    no cuenta como entrenamiento: no suma tonelaje ni mueve el
                    motor. Mañana el bloque vuelve a cero.
                  </p>
                </section>

                {errorNote}
              </>
            ) : (
              <div className="px-5 pt-5">{completeNote}</div>
            )}
          </div>

          {current ? (
            <ActionBar tone="strength" onClick={() => toggle(current.slug)}>
              {next ? "Hecho" : "Terminar"}
            </ActionBar>
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
              // A `Row` is a div and the tick has to stay a real checkbox, so
              // this is Row's shape on a button.
              return (
                <button
                  key={item.id}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggle(item.slug)}
                  className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-3 text-left"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-[22px] w-[22px] flex-none items-center justify-center rounded-sm border",
                      checked
                        ? "border-transparent bg-strength text-on-strength"
                        : "border-hairline bg-transparent",
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
                        "block truncate text-[14.5px] leading-[1.25] font-medium",
                        checked && "text-mid",
                      )}
                    >
                      {item.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] leading-[1.35] text-faint">
                      {item.groupName}
                    </span>
                  </span>
                  <span className="flex-none text-right">
                    <span className="num block text-[14px] leading-none font-semibold">
                      {item.dose}
                    </span>
                    <span className="mt-1 block text-[11px] leading-none text-mid">
                      {item.doseUnit}
                    </span>
                  </span>
                </button>
              );
            })}
          </RowStack>

          {errorNote}

          {allDone ? (
            <div className="mx-5 mt-3.5">{completeNote}</div>
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
