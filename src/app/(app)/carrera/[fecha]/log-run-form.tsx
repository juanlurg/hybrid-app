"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ActionBar } from "@/components/ui/kit";
import { decoupling } from "@/lib/engine/run";
import { enqueueAndFlush } from "@/lib/offline/syncer";
import type { SessionType } from "@/lib/domain/plan";

export interface RunTarget {
  phaseId: string;
  slotId: string;
  date: string;
  week: number;
  dayIndex: number;
  sessionType: SessionType;
  title: string;
  prescription: string;
}

/** Empty stays empty: every field here is optional. Garbage stays null. */
function toNumber(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Decoupling may be negative — a stronger second half is real data. */
function toSignedNumber(value: string): number | null {
  const trimmed = value.trim().replace(",", ".").replace("−", "-");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** "5:30" (or "5,30") → seconds per km; "5,5" reads as decimal minutes. */
function parsePace(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const mmss = trimmed.match(/^(\d{1,2})[:'′.,](\d{2})$/);
  if (mmss) {
    const seconds = Number(mmss[2]);
    return seconds < 60 ? Number(mmss[1]) * 60 + seconds : null;
  }
  const decimal = Number(trimmed.replace(",", "."));
  return Number.isFinite(decimal) && decimal > 0
    ? Math.round(decimal * 60)
    : null;
}

export interface LoggedRun {
  durationMinutes: number | null;
  distanceKm: number | null;
  avgHr: number | null;
  decouplingPct: number | null;
  perceivedEffort: number | null;
  notes: string | null;
}

const asField = (v: number | null) =>
  v == null ? "" : String(v).replace(".", ",");

export function LogRunForm({
  day,
  targetMinutes,
  done,
  logged,
}: {
  day: RunTarget;
  targetMinutes: number;
  done: boolean;
  logged: LoggedRun | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [queued, setQueued] = useState(false);
  const [editing, setEditing] = useState(false);
  // What this device just queued: while the flush has not landed the
  // server prop is stale, and an offline "editar" must not blank the
  // values the athlete typed a minute ago.
  const [justQueued, setJustQueued] = useState<LoggedRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [minutes, setMinutes] = useState("");
  const [distance, setDistance] = useState("");
  const [avgHr, setAvgHr] = useState("");
  const [decouplingPct, setDecouplingPct] = useState("");
  const [rpe, setRpe] = useState<number | null>(null);
  const [notes, setNotes] = useState("");

  // The two-halves Pa:HR calculator, folded under the decoupling field.
  const [calcOpen, setCalcOpen] = useState(false);
  const [pace1, setPace1] = useState("");
  const [hr1, setHr1] = useState("");
  const [pace2, setPace2] = useState("");
  const [hr2, setHr2] = useState("");
  const [calcError, setCalcError] = useState<string | null>(null);

  function computeDecoupling() {
    const p1 = parsePace(pace1);
    const p2 = parsePace(pace2);
    const h1 = toNumber(hr1);
    const h2 = toNumber(hr2);
    if (p1 == null || p2 == null || !h1 || !h2) {
      setCalcError(
        "Faltan datos: ritmo como 5:30 y FC media en ppm, para las dos mitades.",
      );
      return;
    }
    setCalcError(null);
    // The engine's own Pa:HR: ritmo por pulsación, mitad 2 contra mitad 1.
    const pct = decoupling(
      { paceSecPerKm: p1, avgHr: h1 },
      { paceSecPerKm: p2, avgHr: h2 },
    );
    setDecouplingPct(String(pct).replace(".", ","));
  }

  const fields: Array<{
    label: string;
    unit: string;
    value: string;
    onChange: (next: string) => void;
    placeholder: string;
    parse: (value: string) => number | null;
  }> = [
    {
      label: "Duración",
      unit: "min",
      value: minutes,
      onChange: setMinutes,
      placeholder: targetMinutes > 0 ? String(targetMinutes) : "—",
      parse: toNumber,
    },
    {
      label: "Distancia",
      unit: "km",
      value: distance,
      onChange: setDistance,
      placeholder: "—",
      parse: toNumber,
    },
    {
      label: "FC media",
      unit: "ppm",
      value: avgHr,
      onChange: setAvgHr,
      placeholder: "—",
      parse: toNumber,
    },
    {
      label: "Desacople",
      unit: "%",
      value: decouplingPct,
      onChange: setDecouplingPct,
      placeholder: "—",
      parse: toSignedNumber,
    },
  ];

  function submit() {
    setError(null);

    // Something typed that is not a number is a mistake, not a blank.
    const invalid = fields.find(
      (f) => f.value.trim() !== "" && f.parse(f.value) === null,
    );
    if (invalid) {
      setOpen(true);
      setError(`${invalid.label}: escribe un número o déjalo en blanco.`);
      return;
    }

    start(async () => {
      const values: LoggedRun = {
        durationMinutes: toNumber(minutes),
        distanceKm: toNumber(distance),
        avgHr: toNumber(avgHr),
        decouplingPct: toSignedNumber(decouplingPct),
        perceivedEffort: rpe,
        notes: notes.trim() || null,
      };
      // Write-ahead: the run is registered on this device instantly and
      // lands in the database whenever there is network.
      await enqueueAndFlush({
        kind: "run_log",
        key: {
          phaseId: day.phaseId,
          slotId: day.slotId,
          scheduledOn: day.date,
          week: day.week,
          dayIndex: day.dayIndex,
          sessionType: day.sessionType,
          title: day.title,
        },
        prescription: day.prescription,
        durationMinutes: values.durationMinutes,
        distanceKm: values.distanceKm,
        avgHr: values.avgHr,
        decouplingPct: values.decouplingPct,
        perceivedEffort: values.perceivedEffort,
        notes: values.notes ?? "",
        loggedAt: new Date().toISOString(),
      });
      setJustQueued(values);
      setQueued(true);
      setEditing(false);
      setOpen(false);
      router.refresh();
    });
  }

  // Freshest first: what this device queued beats the server render.
  const shown = justQueued ?? logged;

  // A registered run is not a dead end: the values stay visible and the
  // form re-opens prefilled — the watch data often arrives at home,
  // after the "hecha" tap. Same op key, same upsert: fully idempotent.
  if ((done || queued) && !editing) {
    const summary = [
      shown?.durationMinutes != null ? `${shown.durationMinutes}′` : null,
      shown?.distanceKm != null ? `${asField(shown.distanceKm)} km` : null,
      shown?.avgHr != null ? `${shown.avgHr} ppm` : null,
      shown?.decouplingPct != null ? `${asField(shown.decouplingPct)} %` : null,
      shown?.perceivedEffort != null ? `RPE ${shown.perceivedEffort}` : null,
      shown?.notes?.trim() ? "nota" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <div className="flex h-16 flex-none items-center gap-3 bg-ink px-4 text-paper">
        <span className="flex-none text-[13px] leading-none font-extrabold tracking-[0.1em] text-ok-bright uppercase">
          ✓ Registrada
        </span>
        <span className="num min-w-0 flex-1 truncate text-[11px] leading-none opacity-70">
          {summary || "sin datos del reloj"}
        </span>
        <button
          type="button"
          onClick={() => {
            setMinutes(asField(shown?.durationMinutes ?? null));
            setDistance(asField(shown?.distanceKm ?? null));
            setAvgHr(asField(shown?.avgHr ?? null));
            setDecouplingPct(asField(shown?.decouplingPct ?? null));
            setRpe(shown?.perceivedEffort ?? null);
            setNotes(shown?.notes ?? "");
            setEditing(true);
            setOpen(true);
          }}
          className="-mr-3 flex flex-none items-center self-stretch px-3 text-[11px] leading-none font-medium underline opacity-70"
        >
          editar datos
        </button>
      </div>
    );
  }

  return (
    <div className="flex-none">
      {open ? (
        <div className="border-t-2 border-ink bg-sunk">
          <div className="grid grid-cols-2 gap-px bg-line">
            {fields.map((f) => (
              <label key={f.label} className="block bg-sunk px-4 py-3">
                <span className="block text-[9.5px] leading-none font-semibold tracking-[0.12em] text-mid uppercase">
                  {f.label}
                </span>
                <span className="mt-2 flex items-baseline gap-1.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={f.value}
                    placeholder={f.placeholder}
                    onChange={(e) => f.onChange(e.target.value)}
                    className="num w-full min-w-0 bg-transparent text-[22px] leading-none font-black tracking-[-0.03em] outline-none"
                  />
                  <span className="flex-none text-[11px] leading-none font-bold text-mid">
                    {f.unit}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <button
            type="button"
            aria-expanded={calcOpen}
            onClick={() => setCalcOpen((v) => !v)}
            className="flex h-10 w-full items-center justify-between border-t border-line px-4 text-[9.5px] leading-none font-semibold tracking-[0.12em] text-mid uppercase"
          >
            <span>Calcular el desacople con las dos mitades</span>
            <span
              aria-hidden
              className="text-[13px] leading-none font-bold text-ink"
            >
              {calcOpen ? "−" : "+"}
            </span>
          </button>
          {calcOpen ? (
            <>
              <div className="grid grid-cols-2 gap-px border-y border-line bg-line">
                {(
                  [
                    {
                      label: "1ª mitad · ritmo",
                      unit: "min/km",
                      value: pace1,
                      onChange: setPace1,
                      placeholder: "5:30",
                    },
                    {
                      label: "1ª mitad · FC media",
                      unit: "ppm",
                      value: hr1,
                      onChange: setHr1,
                      placeholder: "—",
                    },
                    {
                      label: "2ª mitad · ritmo",
                      unit: "min/km",
                      value: pace2,
                      onChange: setPace2,
                      placeholder: "5:35",
                    },
                    {
                      label: "2ª mitad · FC media",
                      unit: "ppm",
                      value: hr2,
                      onChange: setHr2,
                      placeholder: "—",
                    },
                  ] as const
                ).map((f) => (
                  <label key={f.label} className="block bg-sunk px-4 py-2.5">
                    <span className="block text-[9.5px] leading-none font-semibold tracking-[0.12em] text-mid uppercase">
                      {f.label}
                    </span>
                    <span className="mt-1.5 flex items-baseline gap-1.5">
                      <input
                        type="text"
                        inputMode={f.unit === "ppm" ? "numeric" : undefined}
                        value={f.value}
                        placeholder={f.placeholder}
                        onChange={(e) => f.onChange(e.target.value)}
                        className="num w-full min-w-0 bg-transparent text-[17px] leading-none font-black tracking-[-0.02em] outline-none"
                      />
                      <span className="flex-none text-[10px] leading-none font-bold text-mid">
                        {f.unit}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-3 px-4 py-2.5">
                <button
                  type="button"
                  onClick={computeDecoupling}
                  className="flex h-10 flex-none items-center border-2 border-ink px-3 text-[10px] leading-none font-extrabold tracking-[0.08em] uppercase"
                >
                  Calcular
                </button>
                <span className="min-w-0 flex-1 text-[10.5px] leading-[1.4] text-faint">
                  {calcError ? (
                    <span className="text-fail">{calcError}</span>
                  ) : (
                    "El resultado rellena solo el campo Desacople."
                  )}
                </span>
              </div>
            </>
          ) : null}
          <div className="flex items-center gap-2 px-4 pt-3">
            <span className="text-[9.5px] leading-none font-semibold tracking-[0.12em] text-mid uppercase">
              RPE
            </span>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRpe((v) => (v === n ? null : n))}
                className={
                  rpe === n
                    ? "num flex h-8 w-7 items-center justify-center border-2 border-ink bg-ink text-[12px] leading-none font-extrabold text-paper"
                    : "num flex h-8 w-7 items-center justify-center border-2 border-hairline text-[12px] leading-none font-extrabold text-mid"
                }
              >
                {n}
              </button>
            ))}
          </div>
          <label className="block px-4 pt-3">
            <span className="block text-[9.5px] leading-none font-semibold tracking-[0.12em] text-mid uppercase">
              Notas
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="molestias, sensaciones — la rodilla habla aquí"
              className="mt-2 w-full border-2 border-hairline bg-transparent px-2.5 py-2 text-[13px] leading-[1.4] outline-none"
            />
          </label>
          <p className="px-4 py-3 text-[11px] leading-[1.45] text-faint">
            Todo opcional. El desacople (Pa:HR) no lo da el reloj: cópialo de
            Runalyze o intervals.icu, o calcúlalo aquí con el ritmo y la FC de
            las dos mitades; por debajo del 5 % la base aeróbica aguanta. El
            RPE es la dureza percibida, de 1 a 10 — clave en las semanas de
            readaptación.
          </p>
        </div>
      ) : null}

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-full items-center justify-between border-t-2 border-ink bg-paper px-4 text-[10px] leading-none font-extrabold tracking-[0.12em] text-mid uppercase"
      >
        <span>{open ? "Ocultar datos" : "Añadir datos del reloj"}</span>
        <span aria-hidden className="text-[13px] leading-none font-bold text-ink">
          {open ? "−" : "+"}
        </span>
      </button>

      {error ? (
        <p className="border-t-2 border-fail bg-paper px-4 py-2.5 text-[11.5px] leading-[1.4] text-fail">
          {error}
        </p>
      ) : null}

      <ActionBar tone="run" disabled={pending} onClick={submit}>
        {pending ? "…" : editing ? "Guardar cambios" : "Marcar hecha"}
        {pending ? null : <span className="font-medium">✓</span>}
      </ActionBar>
    </div>
  );
}
