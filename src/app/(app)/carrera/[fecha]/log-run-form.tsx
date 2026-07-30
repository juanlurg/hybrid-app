"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ActionBar } from "@/components/ui/kit";
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

export function LogRunForm({
  day,
  targetMinutes,
  done,
}: {
  day: RunTarget;
  targetMinutes: number;
  done: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [minutes, setMinutes] = useState("");
  const [distance, setDistance] = useState("");
  const [avgHr, setAvgHr] = useState("");
  const [decouplingPct, setDecouplingPct] = useState("");

  const fields: Array<{
    label: string;
    unit: string;
    value: string;
    onChange: (next: string) => void;
    placeholder: string;
  }> = [
    {
      label: "Duración",
      unit: "min",
      value: minutes,
      onChange: setMinutes,
      placeholder: targetMinutes > 0 ? String(targetMinutes) : "—",
    },
    {
      label: "Distancia",
      unit: "km",
      value: distance,
      onChange: setDistance,
      placeholder: "—",
    },
    {
      label: "FC media",
      unit: "ppm",
      value: avgHr,
      onChange: setAvgHr,
      placeholder: "—",
    },
    {
      label: "Desacople",
      unit: "%",
      value: decouplingPct,
      onChange: setDecouplingPct,
      placeholder: "—",
    },
  ];

  function submit() {
    setError(null);

    // Something typed that is not a number is a mistake, not a blank.
    const invalid = fields.find(
      (f) => f.value.trim() !== "" && toNumber(f.value) === null,
    );
    if (invalid) {
      setOpen(true);
      setError(`${invalid.label}: escribe un número o déjalo en blanco.`);
      return;
    }

    start(async () => {
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
        durationMinutes: toNumber(minutes),
        distanceKm: toNumber(distance),
        avgHr: toNumber(avgHr),
        decouplingPct: toNumber(decouplingPct),
        notes: "",
        loggedAt: new Date().toISOString(),
      });
      setQueued(true);
      router.refresh();
    });
  }

  if (done || queued) {
    return (
      <div className="flex h-16 flex-none items-center justify-center gap-3 bg-ink text-[15px] leading-none font-extrabold tracking-[0.1em] text-ok-bright uppercase">
        ✓ Registrado
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
          <p className="px-4 py-3 text-[11px] leading-[1.45] text-faint">
            Todo opcional. El desacople es el Pa:HR que da el reloj al comparar
            las dos mitades del rodaje; por debajo del 5 % la base aeróbica
            aguanta.
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
        {pending ? "…" : "Marcar hecha"}
        {pending ? null : <span className="font-medium">✓</span>}
      </ActionBar>
    </div>
  );
}
