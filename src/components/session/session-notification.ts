"use client";

/**
 * The session's tray notification. One tag, updated in place:
 *
 *  · on rest start — «{ejercicio} · serie n/m · descanso hasta las HH:MM».
 *    The ABSOLUTE end time is the honesty anchor: if the browser freezes
 *    the tab a second later, what the tray says stays true.
 *  · on expiry (page alive) — «descanso terminado», audible/vibrating.
 *  · between rests (Android/desktop only) — «{ejercicio} · n/m series»,
 *    a quiet persistent card while the app is backgrounded.
 *
 * Honest limits, stated here because they are structural: there is no
 * push server and Notification Triggers never shipped, so nothing can
 * fire while the page is dead — a frozen tab keeps its last (absolute-
 * time) notification and nothing more. iOS only grants notifications to
 * an installed PWA (16.4+) and suspends background timers aggressively,
 * so there the end-of-rest ping is best-effort and the persistent layer
 * is deliberately off. Every call is try/catch: this whole file is
 * additive — without permission it is dark and the in-page flash, beep
 * and vibration keep working exactly as before.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

/** Device-local preference, like the theme: permission is per-device. */
export const REST_NOTIFICATIONS_KEY = "bloques:rest-notifications";

const TAG = "bloques-sesion";

export function restNotificationsEnabled(): boolean {
  try {
    return (
      localStorage.getItem(REST_NOTIFICATIONS_KEY) === "on" &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    );
  } catch {
    return false;
  }
}

export function notificationsSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS masquerades as macOS but has touch points.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

async function post(
  body: string,
  opts: { silent: boolean; renotify?: boolean; vibrate?: boolean },
): Promise<void> {
  try {
    if (
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    ) {
      return;
    }
    const reg = await navigator.serviceWorker?.ready;
    if (!reg) return;
    await reg.showNotification("Bloques", {
      tag: TAG,
      body,
      silent: opts.silent,
      renotify: opts.renotify ?? false,
      icon: "/icons/icon-192.svg",
      badge: "/icons/icon-192.svg",
      ...(opts.vibrate ? { vibrate: [140, 90, 140] } : {}),
    } as NotificationOptions);
  } catch {
    // Best-effort, always.
  }
}

async function clearAll(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.ready;
    const list = await reg?.getNotifications({ tag: TAG });
    list?.forEach((n) => n.close());
  } catch {
    // Nothing to clear, or no permission — same outcome.
  }
}

export function useSessionNotification({
  enabled,
  vibration,
}: {
  enabled: boolean;
  vibration: boolean;
}) {
  /** What the live rest is about — for the expiry and extend bodies. */
  const restCtx = useRef<{
    exercise: string;
    setNumber: number;
    totalSets: number;
  } | null>(null);

  const showRest = useCallback(
    (
      exercise: string,
      setNumber: number,
      totalSets: number,
      restSeconds: number,
    ) => {
      if (!enabled) return;
      restCtx.current = { exercise, setNumber, totalSets };
      const hhmm = new Date(
        Date.now() + restSeconds * 1000,
      ).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
      void post(
        `${exercise} · serie ${setNumber}/${totalSets} · descanso hasta las ${hhmm}`,
        { silent: true },
      );
    },
    [enabled],
  );

  /** +30″ moves the deadline; the absolute time in the tray must follow
      or the honesty anchor lies. */
  const extendRest = useCallback(
    (secondsLeftNow: number) => {
      if (!enabled) return;
      const c = restCtx.current;
      if (!c) return;
      const hhmm = new Date(
        Date.now() + secondsLeftNow * 1000,
      ).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
      void post(
        `${c.exercise} · serie ${c.setNumber}/${c.totalSets} · descanso hasta las ${hhmm}`,
        { silent: true },
      );
    },
    [enabled],
  );

  const showExpired = useCallback(() => {
    if (!enabled) return;
    const c = restCtx.current;
    restCtx.current = null;
    void post(
      c
        ? `descanso terminado · ${c.exercise} serie ${c.setNumber}`
        : "descanso terminado",
      { silent: false, renotify: true, vibrate: vibration },
    );
  }, [enabled, vibration]);

  /** The quiet between-rests card. iOS never gets it (no persistent
      notifications there); Android replaces in place via the tag. */
  const showProgress = useCallback(
    (exercise: string, done: number, total: number) => {
      if (!enabled || isIOS()) return;
      void post(`${exercise} · ${done}/${total} series`, { silent: true });
    },
    [enabled],
  );

  /** Rest skipped by hand: replace with progress, or clear on iOS. */
  const dismissRest = useCallback(
    (exercise: string, done: number, total: number) => {
      restCtx.current = null;
      if (!enabled) return;
      if (isIOS()) {
        void clearAll();
        return;
      }
      void post(`${exercise} · ${done}/${total} series`, { silent: true });
    },
    [enabled],
  );

  const clear = useCallback(() => {
    restCtx.current = null;
    void clearAll();
  }, []);

  // Leaving the runner takes the notification with it.
  useEffect(() => () => void clearAll(), []);

  // Stable identity: consumers hang effects off this object.
  return useMemo(
    () => ({
      showRest,
      extendRest,
      showExpired,
      showProgress,
      dismissRest,
      clear,
    }),
    [showRest, extendRest, showExpired, showProgress, dismissRest, clear],
  );
}
