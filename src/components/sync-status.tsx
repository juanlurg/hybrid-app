"use client";

import { useCallback, useEffect, useState } from "react";

import {
  clearSyncFailure,
  oldestPendingAt,
  onFlushResult,
  pendingOps,
  readSyncAlerts,
  type SyncAlerts,
} from "@/lib/offline/syncer";

interface Snapshot {
  pending: number;
  /** Whole days the oldest op has been waiting, at refresh time. */
  ageDays: number;
  /** Older than 24 h with the network up — no longer "just waiting". */
  stuck: boolean;
  alerts: SyncAlerts;
}

/**
 * The queue made visible. Renders nothing while everything is synced;
 * otherwise one hairline row that tells the truth: waiting for network,
 * stuck for days, blocked by auth/programme, or rejected outright.
 * Non-negotiable 8 says the history is the only irreplaceable thing —
 * "weeks of sessions live only in this phone" must never be silent.
 */
export function SyncStatus() {
  const [snap, setSnap] = useState<Snapshot | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [pending, oldestAt, alerts] = await Promise.all([
        pendingOps(),
        oldestPendingAt(),
        readSyncAlerts(),
      ]);
      const ageMs = oldestAt == null ? 0 : Date.now() - oldestAt;
      setSnap({
        pending,
        ageDays: Math.floor(ageMs / (24 * 3600 * 1000)),
        stuck: pending > 0 && ageMs > 24 * 3600 * 1000 && navigator.onLine,
        alerts,
      });
    } catch {
      // No IndexedDB (SSR pass, private mode): stay hidden.
    }
  }, []);

  useEffect(() => {
    // The initial read waits a tick: state lands from IndexedDB, never
    // synchronously inside the effect.
    void Promise.resolve().then(refresh);
    const off = onFlushResult(() => void refresh());
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  if (!snap) return null;
  const { pending, ageDays: days, stuck, alerts } = snap;
  const rejected = alerts.failure;
  if (pending === 0 && !rejected) return null;

  const blockedCopy =
    alerts.blocked?.error === "no_active_program"
      ? "no hay programa activo — actívalo en Ajustes → Datos → Programas."
      : alerts.blocked?.error === "not_authenticated"
        ? "la sesión ha caducado — abre cualquier pantalla para renovarla."
        : alerts.blocked?.error === "bad_request"
          ? "el servidor no entiende este cliente — recarga la app."
          : null;

  return (
    <div className="flex flex-col gap-2 px-5 pb-3">
      {rejected ? (
        <div className="flex items-start gap-2.5 rounded-r-sm border-l-[4px] border-fail py-0.5 pl-3">
          <p className="flex-1 text-[12.5px] leading-[1.5]">
            El servidor rechazó{" "}
            <span className="num font-semibold">{rejected.opCount}</span>{" "}
            {rejected.opCount === 1 ? "apunte" : "apuntes"}:{" "}
            {rejected.reasons[0]}. Esos datos no se van a subir.
          </p>
          <button
            type="button"
            onClick={() => {
              void clearSyncFailure().then(() => void refresh());
            }}
            className="flex-none text-[11.5px] leading-none font-medium text-mid underline"
          >
            entendido
          </button>
        </div>
      ) : null}

      {pending > 0 ? (
        <p
          className={
            stuck
              ? "rounded-r-sm border-l-[4px] border-warn py-0.5 pl-3 text-[12.5px] leading-[1.5]"
              : "text-[12px] leading-[1.45] text-faint"
          }
        >
          <span className="num font-semibold">{pending}</span>{" "}
          {pending === 1 ? "apunte pendiente" : "apuntes pendientes"} de subir
          {stuck ? (
            <>
              {" "}
              desde hace <span className="num font-semibold">{days}</span>{" "}
              {days === 1 ? "día" : "días"} con red —{" "}
              {blockedCopy ?? "algo lo está bloqueando."}
            </>
          ) : blockedCopy ? (
            <> — {blockedCopy}</>
          ) : (
            ". Se sincronizan solos."
          )}
        </p>
      ) : null}
    </div>
  );
}
