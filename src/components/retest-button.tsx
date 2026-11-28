"use client";

import { Check } from "lucide-react";
import { useState, useTransition } from "react";

import { recordMeasurement } from "@/lib/actions/program";
import { formatWeight } from "@/lib/engine";

/**
 * The one way a re-test reaches the engine: the athlete reads the number
 * and takes it. With "Recalcular RM tras el re-test" off in Ajustes it is
 * only filed, and the RM stays where it was.
 */
export function RetestButton({
  liftId,
  liftName,
  rmKg,
  takenOn,
  sessionId,
  syncs,
}: {
  liftId: string;
  liftName: string;
  /** Already at the rounding step: the RM the lift would take. */
  rmKg: number;
  takenOn: string;
  sessionId?: string;
  /** profiles.sync_rm_after_retest */
  syncs: boolean;
}) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <div className="mt-3 flex h-12 items-center justify-center gap-2 rounded-xl bg-ok-soft text-[14px] leading-none font-bold text-ok">
        <Check aria-hidden size={16} strokeWidth={2.5} />
        {syncs
          ? `RM de ${liftName.toLowerCase()}: ${formatWeight(rmKg)} kg`
          : "Re-test guardado"}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await recordMeasurement({
              kind: "rm_estimate",
              takenOn,
              label: liftName,
              value: rmKg,
              unit: "kg",
              liftId,
              sessionId,
            });
            if (res.ok) setDone(true);
            else setError(res.error ?? "No se ha podido guardar.");
          })
        }
        className="num mt-3 flex h-12 w-full items-center justify-center rounded-xl bg-strength text-[14px] leading-none font-bold text-on-strength shadow-cta disabled:opacity-40"
      >
        {pending
          ? "…"
          : syncs
            ? `Usar ${formatWeight(rmKg)} kg como RM`
            : `Guardar el re-test · ${formatWeight(rmKg)} kg`}
      </button>
      {syncs ? null : (
        <p className="mt-2 text-[12px] leading-[1.45] font-medium text-mid">
          «Recalcular RM tras el re-test» está apagado en Ajustes: se guarda
          el resultado y la RM no se mueve.
        </p>
      )}
      {error ? (
        <p className="mt-2 text-[12.5px] leading-[1.4] font-semibold text-fail">
          {error}
        </p>
      ) : null}
    </>
  );
}
