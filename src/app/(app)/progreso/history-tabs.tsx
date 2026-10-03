"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

const TABS = [
  { key: "constancia", label: "Constancia" },
  { key: "records", label: "Récords" },
  { key: "registro", label: "Registro" },
  { key: "carrera", label: "Carrera" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * Four ledgers, one at a time: ~90 data points in a single scroll read
 * as noise. Panes stay mounted (hidden, not unmounted) so
 * the log's filter and an expanded row survive switching away.
 */
export function HistoryTabs({
  constancia,
  records,
  registro,
  carrera,
}: Record<TabKey, ReactNode>) {
  const [tab, setTab] = useState<TabKey>("constancia");
  const panes: Record<TabKey, ReactNode> = {
    constancia,
    records,
    registro,
    carrera,
  };

  return (
    <>
      <div className="mx-5 mt-5 flex gap-1 rounded-full bg-quiet p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "h-9 min-w-0 flex-1 truncate rounded-full px-1 text-[13px] leading-none font-bold",
              tab === t.key ? "bg-surface text-ink shadow-raised" : "text-mid",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {TABS.map((t) => (
        <div key={t.key} hidden={tab !== t.key}>
          {panes[t.key]}
        </div>
      ))}
    </>
  );
}
