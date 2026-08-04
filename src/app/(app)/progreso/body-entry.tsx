"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { recordBodyMetric } from "@/lib/actions/profile";

/** Inline quick-entry for today's scale reading. One row per day upstream. */
export function BodyEntry({
  initialWeight,
  initialWaist,
}: {
  /** Today's values as decimal-comma strings, empty when not logged yet. */
  initialWeight: string;
  initialWaist: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [weight, setWeight] = useState(initialWeight);
  const [waist, setWaist] = useState(initialWaist);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const weightKg = Number(weight.trim().replace(",", "."));
    if (!weight.trim() || !Number.isFinite(weightKg) || weightKg <= 0) {
      setError("Peso: escribe un número.");
      return;
    }
    const waistRaw = waist.trim();
    const waistCm = waistRaw ? Number(waistRaw.replace(",", ".")) : null;
    if (waistRaw && (!Number.isFinite(waistCm!) || waistCm! <= 0)) {
      setError("Cintura: escribe un número o déjala en blanco.");
      return;
    }
    setError(null);
    start(async () => {
      const res = await recordBodyMetric({ weightKg, waistCm });
      if (!res.ok) {
        setError(res.error ?? "No se ha podido guardar.");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  const field = (
    label: string,
    unit: string,
    value: string,
    onChange: (next: string) => void,
  ) => (
    <label className="min-w-0 flex-1">
      <span className="block text-[9.5px] leading-none font-semibold tracking-[0.12em] text-mid uppercase">
        {label}
      </span>
      <span className="mt-1.5 flex items-baseline gap-1.5">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          placeholder="—"
          onChange={(e) => {
            onChange(e.target.value);
            setSaved(false);
          }}
          className="num h-10 w-full min-w-0 border-2 border-ink bg-transparent px-2 text-[15px] leading-none font-black"
        />
        <span className="flex-none text-[10px] leading-none font-bold text-mid">
          {unit}
        </span>
      </span>
    </label>
  );

  return (
    <div className="mt-3.5">
      <div className="flex items-end gap-2.5">
        {field("Peso hoy", "kg", weight, setWeight)}
        {field("Cintura (opc.)", "cm", waist, setWaist)}
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="flex h-10 flex-none items-center border-2 border-ink bg-ink px-3 text-[10px] leading-none font-extrabold tracking-[0.08em] text-paper uppercase disabled:opacity-40"
        >
          {pending ? "…" : saved ? "✓ Hoy" : "Anotar"}
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-[10.5px] leading-[1.4] text-fail">{error}</p>
      ) : null}
    </div>
  );
}
