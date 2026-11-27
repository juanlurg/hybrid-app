"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Chip, SectionLabel } from "@/components/ui/kit";
import { cn } from "@/lib/cn";
import type { ExtraType } from "@/lib/offline/queue";
import { enqueueAndFlush } from "@/lib/offline/syncer";

export interface LoggedExtra {
  id: string;
  sessionType: ExtraType;
  title: string;
  durationMinutes: number | null;
  distanceKm: number | null;
  avgHr: number | null;
  perceivedEffort: number | null;
  notes: string;
}

/** What it was. Only a run files as running; the rest is aerobic work. */
const KINDS: Array<{ title: string; type: ExtraType }> = [
  { title: "Rodillo", type: "cross" },
  { title: "Bici", type: "cross" },
  { title: "Carrera", type: "run_easy" },
  { title: "Caminata", type: "cross" },
  { title: "Natación", type: "cross" },
  { title: "Otra", type: "cross" },
];

/** Empty stays empty; garbage stays null. */
function toNumber(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

const asField = (v: number | null) =>
  v == null ? "" : String(v).replace(".", ",");

const WELL = "flex h-12 items-center gap-1.5 rounded-lg bg-soft px-3.5";

export function ExtraForm({
  date,
  editing,
  back,
}: {
  date: string;
  editing: LoggedExtra | null;
  /** Where the athlete came from: the week, or Hoy. */
  back: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [title, setTitle] = useState(editing?.title ?? KINDS[0].title);
  const [minutes, setMinutes] = useState(
    asField(editing?.durationMinutes ?? null),
  );
  const [distance, setDistance] = useState(asField(editing?.distanceKm ?? null));
  const [avgHr, setAvgHr] = useState(asField(editing?.avgHr ?? null));
  const [rpe, setRpe] = useState<number | null>(
    editing?.perceivedEffort ?? null,
  );
  const [notes, setNotes] = useState(editing?.notes ?? "");

  const fields = [
    { label: "Duración", unit: "min", value: minutes, onChange: setMinutes },
    { label: "Distancia", unit: "km", value: distance, onChange: setDistance },
    { label: "FC media", unit: "ppm", value: avgHr, onChange: setAvgHr },
  ];

  function leave() {
    router.push(back);
    router.refresh();
  }

  function submit() {
    setError(null);
    const invalid = fields.find(
      (f) => f.value.trim() !== "" && toNumber(f.value) === null,
    );
    if (invalid) {
      setError(`${invalid.label}: escribe un número o déjalo en blanco.`);
      return;
    }
    const durationMinutes = toNumber(minutes);
    if (!durationMinutes) {
      setError("Pon al menos la duración: es lo que suma.");
      return;
    }
    const hr = toNumber(avgHr);

    start(async () => {
      // Same write-ahead queue as everything else: registered on this
      // device now, in the database whenever there is network.
      await enqueueAndFlush({
        kind: "extra_log",
        id: editing?.id ?? crypto.randomUUID(),
        scheduledOn: date,
        sessionType:
          KINDS.find((k) => k.title === title)?.type ??
          editing?.sessionType ??
          "cross",
        title,
        durationMinutes,
        distanceKm: toNumber(distance),
        avgHr: hr == null ? null : Math.round(hr),
        perceivedEffort: rpe,
        notes: notes.trim(),
        loggedAt: new Date().toISOString(),
      });
      leave();
    });
  }

  function remove() {
    if (!editing) return;
    start(async () => {
      await enqueueAndFlush({ kind: "extra_delete", id: editing.id });
      leave();
    });
  }

  return (
    <>
      <SectionLabel className="pb-2.5">Qué has hecho</SectionLabel>
      <div className="flex flex-wrap gap-1.5 px-5">
        {KINDS.map((k) => (
          <Chip
            key={k.title}
            active={title === k.title}
            aria-pressed={title === k.title}
            onClick={() => setTitle(k.title)}
            className={title === k.title ? "bg-run text-on-run" : "bg-surface"}
          >
            {k.title}
          </Chip>
        ))}
      </div>

      <div className="mx-5 mt-3.5 rounded-2xl bg-surface p-3.5 shadow-card">
        <div className="grid grid-cols-3 gap-2.5">
          {fields.map((f) => (
            <label key={f.label} className="flex flex-col gap-1.5">
              <span className="block text-[12px] leading-none font-semibold text-mid">
                {f.label}
              </span>
              <span className={WELL}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={f.value}
                  placeholder="—"
                  onChange={(e) => f.onChange(e.target.value)}
                  className="num w-full min-w-0 bg-transparent text-[17px] leading-none font-bold outline-none"
                />
                <span className="flex-none text-[12px] leading-none font-semibold text-mid">
                  {f.unit}
                </span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-1">
          <span className="w-9 flex-none text-[12px] leading-none font-bold text-mid">
            RPE
          </span>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={rpe === n}
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

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Nota — «Z1 en el rodillo viendo la etapa» (opcional)"
          aria-label="Nota de la sesión"
          className="mt-3 w-full rounded-lg bg-soft px-3.5 py-3 text-[13px] leading-[1.45] font-medium outline-none"
        />
      </div>

      {error ? (
        <p className="mx-5 mt-3 rounded-lg bg-fail-soft px-3.5 py-2.5 text-[12.5px] leading-[1.4] font-semibold text-fail">
          {error}
        </p>
      ) : null}

      <div className="sticky bottom-0 flex flex-none gap-2.5 bg-bg px-4 pt-3.5 pb-3">
        {editing ? (
          confirmDelete ? (
            <div className="flex h-14 flex-none items-center gap-4 rounded-xl bg-surface px-4 shadow-raised">
              <span className="text-[13px] leading-none font-semibold text-mid">
                ¿Borrar?
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={remove}
                className="py-2 text-[14px] leading-none font-bold text-fail"
              >
                Sí
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="py-2 text-[14px] leading-none font-bold text-mid"
              >
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="h-14 flex-none rounded-xl bg-surface px-4 text-[14px] leading-none font-bold text-ink shadow-raised"
            >
              Borrar
            </button>
          )
        ) : null}
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="flex h-14 min-w-0 flex-1 items-center justify-center gap-2.5 rounded-xl bg-run text-[16px] leading-none font-bold text-on-run shadow-cta-run active:opacity-85 disabled:opacity-40"
        >
          {pending ? null : <Check aria-hidden size={18} strokeWidth={2.5} />}
          {pending ? "…" : editing ? "Guardar cambios" : "Registrar"}
        </button>
      </div>
    </>
  );
}
