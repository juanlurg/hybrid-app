"use client";

import { useMemo, useRef, useState, useTransition } from "react";

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
import { useRestTimer } from "@/components/session/rest-timer";
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

/** Seconds to change sides on a hold done one side at a time. */
const SWITCH_SECONDS = 5;

/**
 * The countdown a hold needs, read off its dose: "45" + "segundos por
 * lado" is 45″, a breath to change sides, 45″. The dose is free text, so
 * anything that is not a plain number of seconds simply has no clock.
 */
function holdPhases(item: MobilityItem): Array<{ label: string; seconds: number }> {
  const seconds = /^\d+$/.test(item.dose.trim()) ? Number(item.dose) : 0;
  if (!seconds || !/segundo/i.test(item.doseUnit)) return [];
  if (!/por lado/i.test(item.doseUnit)) return [{ label: "aguanta", seconds }];
  return [
    { label: "primer lado", seconds },
    { label: "cambia de lado", seconds: SWITCH_SECONDS },
    { label: "segundo lado", seconds },
  ];
}

/* The mode chips ride inside the top bar, so they run a size below the kit's
   default and the inactive one recedes into the surface. */
const modeChip = "px-3 py-2.5 text-[11px] font-bold uppercase";
const inactiveChip = "bg-surface font-semibold text-mid";

export function MobilityBlock({
  items,
  initialCompleted,
  performedOn,
  dateLabel,
  sound,
  vibration,
}: {
  items: MobilityItem[];
  initialCompleted: string[];
  performedOn: string;
  dateLabel: string;
  sound: boolean;
  vibration: boolean;
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

  /* A hold runs on the clock: tap once, keep the position, and the block
     moves on by itself when the last side is done. */
  const phases = current ? holdPhases(current) : [];
  const phaseRef = useRef(0);
  const [phase, setPhase] = useState(0);
  const { rest, flash, start, stop } = useRestTimer({
    sound,
    vibration,
    onExpire: () => {
      const next = phaseRef.current + 1;
      if (current && next < phases.length) {
        phaseRef.current = next;
        setPhase(next);
        start(phases[next].seconds, phases[next].label);
      } else if (current) {
        toggle(current.slug);
      }
    },
  });

  function startHold() {
    phaseRef.current = 0;
    setPhase(0);
    start(phases[0].seconds, phases[0].label);
  }

  /** Done by hand, clock or not. */
  function finishCurrent() {
    if (!current) return;
    stop();
    toggle(current.slug);
  }

  const completeNote = (
    <Callout eyebrow="Bloque completo" eyebrowTone="text-ok-bright">
      Los <span className="num">{items.length}</span> ejercicios quedan
      registrados el <span className="num">{dateLabel}</span>. Glúteo, psoas y
      tobillo: lo que protege la rodilla en la tirada larga.
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
              onClick={() => {
                stop();
                setMode("list");
              }}
              className={cn(modeChip, mode !== "list" && inactiveChip)}
            >
              Lista
            </Chip>
          </span>
        }
      />

      {items.length === 0 ? (
        <Footnote>
          No hay ejercicios de movilidad cargados, así que el bloque de hoy
          está vacío.
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
                      : TONE.quiet,
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
                      <span className="num flex-none text-[58px] leading-[0.95] font-bold tracking-[-0.02em] text-clay min-[390px]:text-[76px]">
                        {rest ? rest.left : current.dose}
                      </span>
                      {rest ? (
                        <span className="font-display max-w-[104px] min-w-0 flex-1 text-[15px] leading-[1.3] font-semibold text-mid uppercase">
                          {phases[phase]?.label}
                        </span>
                      ) : current.doseUnit ? (
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

                  <p className="mt-4 px-1 text-[12px] leading-[1.55] text-mid">
                    {current.groupName === items[0].groupName
                      ? `${current.groupName} va primero: si hoy solo hay 5 minutos, haz este grupo antes de la barra.`
                      : "Lo que marques queda guardado aunque no termines el bloque."}
                  </p>
                </section>

                {errorNote}
              </>
            ) : (
              <div className="px-5 pt-5">{completeNote}</div>
            )}
          </div>

          {current && phases.length > 0 && !rest ? (
            <div className="flex flex-none gap-2.5 px-4 pt-3.5 pb-3">
              <button
                type="button"
                onClick={finishCurrent}
                className="h-14 flex-none rounded-xl bg-surface px-4 text-[14px] leading-none font-bold text-ink shadow-raised"
              >
                Ya está
              </button>
              <ActionBar
                className="min-w-0 flex-1 p-0"
                tone="strength"
                onClick={startHold}
              >
                Empezar <span className="num">{current.dose}″</span>
              </ActionBar>
            </div>
          ) : current ? (
            <ActionBar tone="strength" onClick={finishCurrent}>
              {rest ? "Ya está" : next ? "Hecho" : "Terminar"}
            </ActionBar>
          ) : null}

          {flash ? (
            <div
              aria-hidden
              className="animate-flash pointer-events-none fixed inset-0 z-30"
              style={{ background: TONE.okBright }}
            />
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
              <span className="num">{items.length}</span>. Lo marcado queda
              guardado el <span className="num">{dateLabel}</span> aunque no
              termines el bloque.
            </Footnote>
          )}
        </div>
      )}
    </div>
  );
}
