"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { SectionLabel } from "@/components/ui/kit";
import { cn } from "@/lib/cn";
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

export interface LoggedRun {
  durationMinutes: number | null;
  distanceKm: number | null;
  avgHr: number | null;
  decouplingPct: number | null;
  perceivedEffort: number | null;
}

const asField = (v: number | null) =>
  v == null ? "" : String(v).replace(".", ",");

const WELL = "flex h-12 items-center gap-1.5 rounded-lg bg-soft px-3.5";

export function LogRunForm({
  day,
  targetMinutes,
  done,
  logged,
  skip,
}: {
  day: RunTarget;
  targetMinutes: number;
  done: boolean;
  logged: LoggedRun | null;
  /** The quiet "saltar" beside the action, when the day still allows it. */
  skip?: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [queued, setQueued] = useState(false);
  const [editing, setEditing] = useState(false);
  // What this device just queued: while the flush has not landed the
  // server prop is stale, and an offline "editar" must not blank the
  // values the athlete typed a minute ago.
  const [justQueued, setJustQueued] = useState<LoggedRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The tiles are the form, so a registered run opens prefilled.
  const [minutes, setMinutes] = useState(
    asField(logged?.durationMinutes ?? null),
  );
  const [distance, setDistance] = useState(asField(logged?.distanceKm ?? null));
  const [avgHr, setAvgHr] = useState(asField(logged?.avgHr ?? null));
  const [decouplingPct, setDecouplingPct] = useState(
    asField(logged?.decouplingPct ?? null),
  );
  const [rpe, setRpe] = useState<number | null>(
    logged?.perceivedEffort ?? null,
  );

  // Freshest first: what this device queued beats the server render.
  const shown = justQueued ?? logged;

  const fields: Array<{
    label: string;
    unit: string;
    value: string;
    onChange: (next: string) => void;
    placeholder: string;
    saved: number | null;
  }> = [
    {
      label: "Duración",
      unit: "min",
      value: minutes,
      onChange: setMinutes,
      placeholder: targetMinutes > 0 ? String(targetMinutes) : "—",
      saved: shown?.durationMinutes ?? null,
    },
    {
      label: "Distancia",
      unit: "km",
      value: distance,
      onChange: setDistance,
      placeholder: "—",
      saved: shown?.distanceKm ?? null,
    },
    {
      label: "FC media",
      unit: "ppm",
      value: avgHr,
      onChange: setAvgHr,
      placeholder: "—",
      saved: shown?.avgHr ?? null,
    },
    {
      label: "Desacople Pa:HR",
      unit: "%",
      value: decouplingPct,
      onChange: setDecouplingPct,
      placeholder: "—",
      saved: shown?.decouplingPct ?? null,
    },
  ];

  function submit() {
    setError(null);

    // Something typed that is not a number is a mistake, not a blank.
    const invalid = fields.find(
      (f) => f.value.trim() !== "" && toNumber(f.value) === null,
    );
    if (invalid) {
      setError(`${invalid.label}: escribe un número o déjalo en blanco.`);
      return;
    }

    start(async () => {
      const values: LoggedRun = {
        durationMinutes: toNumber(minutes),
        distanceKm: toNumber(distance),
        avgHr: toNumber(avgHr),
        decouplingPct: toNumber(decouplingPct),
        perceivedEffort: rpe,
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
        notes: "",
        loggedAt: new Date().toISOString(),
      });
      setJustQueued(values);
      setQueued(true);
      setEditing(false);
      router.refresh();
    });
  }

  // A registered run is not a dead end: the values stay on the tiles and
  // "editar datos" makes them writable again — the watch data often
  // arrives at home, after the "hecha" tap. Same op key, same upsert.
  const registered = (done || queued) && !editing;

  const summary = [
    shown?.durationMinutes != null ? `${shown.durationMinutes}′` : null,
    shown?.distanceKm != null ? `${asField(shown.distanceKm)} km` : null,
    shown?.avgHr != null ? `${shown.avgHr} ppm` : null,
    shown?.decouplingPct != null ? `${asField(shown.decouplingPct)} %` : null,
    shown?.perceivedEffort != null ? `RPE ${shown.perceivedEffort}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <SectionLabel className="pb-2.5" right="opcional">
        Datos del reloj
      </SectionLabel>

      <div className="mx-5 rounded-2xl bg-surface p-3.5 shadow-card">
        <div className="grid grid-cols-2 gap-2.5">
          {fields.map((f) => {
            const label = (
              <span className="block text-[12px] leading-none font-semibold text-mid">
                {f.label}
              </span>
            );
            const unit = (
              <span className="flex-none text-[13px] leading-none font-semibold text-mid">
                {f.unit}
              </span>
            );
            return registered ? (
              <div key={f.label} className="flex flex-col gap-1.5">
                {label}
                <span className={WELL}>
                  <span
                    className={cn(
                      "num min-w-0 flex-1 truncate text-[17px] leading-none font-bold",
                      f.saved == null && "text-faint",
                    )}
                  >
                    {f.saved == null ? "—" : asField(f.saved)}
                  </span>
                  {unit}
                </span>
              </div>
            ) : (
              <label key={f.label} className="flex flex-col gap-1.5">
                {label}
                <span className={WELL}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={f.value}
                    placeholder={f.placeholder}
                    onChange={(e) => f.onChange(e.target.value)}
                    className="num w-full min-w-0 bg-transparent text-[17px] leading-none font-bold outline-none"
                  />
                  {unit}
                </span>
              </label>
            );
          })}
        </div>

        {registered ? null : (
          <div className="mt-3 flex items-center gap-1">
            <span className="w-9 flex-none text-[12px] leading-none font-bold text-mid">
              RPE
            </span>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRpe((v) => (v === n ? null : n))}
                className={cn(
                  "num flex h-10 min-w-0 flex-1 items-center justify-center rounded-[10px] text-[13px] leading-none font-bold",
                  rpe === n ? "bg-run text-on-run" : "bg-soft text-ink",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        )}

        {registered ? null : (
          <p className="mt-3 text-[12.5px] leading-[1.5] font-medium text-mid">
            Desacople: el Pa:HR que da el reloj en tiradas largas. RPE: lo dura
            que se ha sentido, de 1 a 10.
          </p>
        )}
      </div>

      {error ? (
        <p className="mx-5 mt-3 rounded-lg bg-fail-soft px-3.5 py-2.5 text-[12.5px] leading-[1.4] font-semibold text-fail">
          {error}
        </p>
      ) : null}

      {registered ? (
        <div className="sticky bottom-0 flex-none bg-bg px-4 pt-3.5 pb-3">
          <div className="flex h-14 items-center gap-3 rounded-xl bg-ok-soft px-4">
            <span className="flex flex-none items-center gap-1.5 text-[15px] leading-none font-bold text-ok">
              <Check aria-hidden size={18} strokeWidth={2.5} />
              Hecha
            </span>
            <span className="num min-w-0 flex-1 truncate text-[12.5px] leading-none font-semibold text-mid">
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
                setEditing(true);
              }}
              className="-my-3 flex h-11 flex-none items-center text-[13px] leading-none font-bold text-clay"
            >
              Editar
            </button>
          </div>
        </div>
      ) : (
        <div className="sticky bottom-0 flex flex-none gap-2.5 bg-bg px-4 pt-3.5 pb-3">
          {editing ? null : skip}
          <button
            type="button"
            disabled={pending}
            onClick={submit}
            className="flex h-14 min-w-0 flex-1 items-center justify-center gap-2.5 rounded-xl bg-run text-[16px] leading-none font-bold text-on-run shadow-cta-run active:opacity-85 disabled:opacity-40"
          >
            {pending ? null : <Check aria-hidden size={18} strokeWidth={2.5} />}
            {pending ? "…" : editing ? "Guardar cambios" : "Marcar hecha"}
          </button>
        </div>
      )}
    </>
  );
}
