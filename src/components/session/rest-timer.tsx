"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { TONE } from "@/components/day-accents";

export interface RestState {
  left: number;
  total: number;
  label: string;
}

/**
 * One AudioContext for the whole session, created inside a user gesture.
 * iOS silences contexts born outside a tap — creating it when the timer
 * *expires* (no gesture) produced a mute first beep on the iPhone.
 */
let audioCtx: AudioContext | null = null;

function primeAudio() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    audioCtx ??= new Ctor();
    if (audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    // No audio device: the vibration and flash still fire.
  }
}

/** Short square-wave beep. Cheap, and audible over a gym playlist. */
function beep() {
  try {
    if (!audioCtx) primeAudio();
    const ctx = audioCtx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "square";
    osc.frequency.value = 760;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    // Autoplay policy or no audio device: the vibration and flash still fire.
  }
}

export interface RestSnapshot {
  deadlineEpochMs: number;
  totalSeconds: number;
  label: string;
}

export function useRestTimer({
  sound,
  vibration,
  onChange,
}: {
  sound: boolean;
  vibration: boolean;
  /** Fires on start/extend/stop/expiry — the hook's persistence outlet. */
  onChange?: (rest: RestSnapshot | null) => void;
}) {
  const [rest, setRest] = useState<RestState | null>(null);
  const [flash, setFlash] = useState(false);
  // Wall-clock deadline: a background tab throttles the interval, but the
  // remaining time still has to be right when the athlete looks back.
  const deadline = useRef<number | null>(null);
  const notify = useRef(onChange);
  useEffect(() => {
    notify.current = onChange;
  }, [onChange]);

  const start = useCallback(
    (seconds: number, label: string) => {
      // `start` runs inside the tap that logged the set — the only place
      // iOS lets us unlock audio for the beep that fires later.
      if (sound) primeAudio();
      if (seconds <= 0) {
        deadline.current = null;
        setRest(null);
        notify.current?.(null);
        return;
      }
      deadline.current = Date.now() + seconds * 1000;
      setRest({ left: seconds, total: seconds, label });
      notify.current?.({
        deadlineEpochMs: deadline.current,
        totalSeconds: seconds,
        label,
      });
    },
    [sound],
  );

  /** Rehydrate a persisted deadline — a reload mid-rest keeps counting. */
  const resume = useCallback((snapshot: RestSnapshot) => {
    const left = Math.round((snapshot.deadlineEpochMs - Date.now()) / 1000);
    if (left <= 0) return;
    deadline.current = snapshot.deadlineEpochMs;
    setRest({ left, total: snapshot.totalSeconds, label: snapshot.label });
  }, []);

  const stop = useCallback(() => {
    deadline.current = null;
    setRest(null);
    notify.current?.(null);
  }, []);

  const extend = useCallback((seconds: number) => {
    setRest((prev) => {
      if (!prev) return prev;
      deadline.current = (deadline.current ?? Date.now()) + seconds * 1000;
      notify.current?.({
        deadlineEpochMs: deadline.current,
        totalSeconds: prev.total + seconds,
        label: prev.label,
      });
      return {
        ...prev,
        left: prev.left + seconds,
        total: prev.total + seconds,
      };
    });
  }, []);

  useEffect(() => {
    if (!rest) return;
    const tick = window.setInterval(() => {
      if (deadline.current == null) return;
      const left = Math.round((deadline.current - Date.now()) / 1000);
      if (left <= 0) {
        deadline.current = null;
        setRest(null);
        notify.current?.(null);
        setFlash(true);
        window.setTimeout(() => setFlash(false), 1100);
        if (vibration && typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate([140, 90, 140]);
        }
        if (sound) beep();
        return;
      }
      setRest((prev) => (prev ? { ...prev, left } : prev));
    }, 250);
    return () => window.clearInterval(tick);
  }, [rest, sound, vibration]);

  return { rest, flash, start, stop, extend, resume };
}

export function RestBar({
  rest,
  onSkip,
  onExtend,
}: {
  rest: RestState;
  onSkip: () => void;
  onExtend: () => void;
}) {
  const mins = Math.floor(rest.left / 60);
  const secs = String(rest.left % 60).padStart(2, "0");
  const pct = Math.max(0, Math.round((rest.left / rest.total) * 100));

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 bg-ink px-4 pt-3.5 pb-3.5 text-paper">
      <div className="flex items-baseline gap-2.5">
        <span className="text-[10px] leading-none font-extrabold tracking-[0.14em] opacity-55 uppercase">
          Descanso
        </span>
        <span className="truncate text-[10.5px] leading-none font-medium opacity-45">
          {rest.label}
        </span>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span
          className="num text-[54px] leading-[0.85] font-black tracking-[-0.04em]"
          style={{ color: TONE.okBright }}
          aria-live="off"
        >
          {mins}:{secs}
        </span>
        {/* Ending rest early is a between-sets staple: a real block
            target, not an 11px underline under a fatigued thumb. */}
        <button
          type="button"
          onClick={onSkip}
          className="ml-auto flex h-11 items-center bg-ink-2 px-4 text-[13px] leading-none font-bold"
        >
          SALTAR
        </button>
        <button
          type="button"
          onClick={onExtend}
          className="flex h-11 items-center bg-ink-2 px-4 text-[13px] leading-none font-bold"
        >
          +30 S
        </button>
      </div>
      <div className="mt-3 h-[5px] bg-ink-2">
        <div
          className="h-full transition-[width] duration-300 ease-linear"
          style={{ width: `${pct}%`, background: TONE.okBright }}
        />
      </div>
    </div>
  );
}

/** Keeps the screen on during a session, when the browser allows it. */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined") return;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
    };
    if (!nav.wakeLock) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const lock = await nav.wakeLock!.request("screen");
        if (cancelled) {
          void lock.release();
          return;
        }
        sentinel = lock;
        // The browser releases the lock on its own when the tab hides;
        // without clearing the sentinel here, the visibilitychange
        // re-acquire below never fires again after the first app switch.
        lock.addEventListener("release", () => {
          if (sentinel === lock) sentinel = null;
        });
      } catch {
        // Denied or unsupported — nothing to fall back to.
      }
    };

    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !sentinel) void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [enabled]);
}
