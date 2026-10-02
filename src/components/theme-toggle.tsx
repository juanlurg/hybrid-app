"use client";

import { useEffect, useSyncExternalStore } from "react";

import { cn } from "@/lib/cn";
import { THEME_COLOR, THEME_KEY, type ThemePref } from "@/lib/theme";

const OPTIONS: Array<{ value: ThemePref; label: string }> = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
  { value: "system", label: "Sistema" },
];

/* The preference lives in localStorage, so it is an external store: the
   chips read it rather than mirroring it into React state. */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function readPref(): ThemePref {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function apply(pref: ThemePref) {
  const dark =
    pref === "dark" ||
    (pref === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";

  /* The two `theme-color` metas are keyed on the OS preference, which an
     override contradicts: pin both to the resolved colour so the browser
     chrome cannot end up dark above a light app. */
  for (const meta of document.querySelectorAll("meta[name=theme-color]")) {
    const own = meta.getAttribute("media")?.includes("dark")
      ? THEME_COLOR.dark
      : THEME_COLOR.light;
    meta.setAttribute(
      "content",
      pref === "system" ? own : dark ? THEME_COLOR.dark : THEME_COLOR.light,
    );
  }
}

/** Three chips. The theme itself was already stamped before first paint. */
export function ThemeToggle() {
  const pref = useSyncExternalStore(subscribe, readPref, () => "system");

  // "Sistema" keeps meaning the system after the first paint too.
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => apply("system");
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [pref]);

  function choose(next: ThemePref) {
    if (next === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
    apply(next);
    for (const notify of listeners) notify();
  }

  return (
    <div className="flex gap-1 rounded-full bg-soft p-1">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === pref}
          onClick={() => choose(o.value)}
          className={cn(
            "h-9 flex-1 rounded-full text-[13.5px] leading-none font-bold",
            o.value === pref
              ? "bg-surface text-ink shadow-raised"
              : "text-mid",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
