"use client";

import { useState, type ReactNode } from "react";

import { Chip } from "@/components/ui/kit";

const TABS = [
  { key: "constancia", label: "Constancia" },
  { key: "records", label: "Récords" },
  { key: "registro", label: "Registro" },
  { key: "motor", label: "Motor" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * The season's four ledgers, one at a time: ~90 data points in a single
 * scroll read as noise. Panes stay mounted (hidden, not unmounted) so
 * the log's filter and an expanded row survive switching away.
 */
export function HistoryTabs({
  constancia,
  records,
  registro,
  motor,
}: Record<TabKey, ReactNode>) {
  const [tab, setTab] = useState<TabKey>("constancia");
  const panes: Record<TabKey, ReactNode> = {
    constancia,
    records,
    registro,
    motor,
  };

  return (
    <>
      <div className="flex flex-wrap gap-1.5 px-5 pt-4">
        {TABS.map((t) => (
          <Chip
            key={t.key}
            active={tab === t.key}
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </Chip>
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
