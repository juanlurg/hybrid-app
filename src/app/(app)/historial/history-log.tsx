"use client";

import Link from "next/link";
import { useState } from "react";

import { Chip, Row, RowStack, SessionRow } from "@/components/ui/kit";
import type { SessionGroup, SessionStatus } from "@/lib/domain/plan";

export interface HistoryEntry {
  id: string;
  group: SessionGroup;
  accent: string;
  title: string;
  status: SessionStatus;
  statusLabel: string;
  statusTone: string;
  subtitle: string;
  /** The right-hand figure: tonnage, minutes, items. */
  headline: string;
  dateLabel: string;
  incomplete: boolean;
  details: Array<{ label: string; value: string }>;
  /** The session's own screen, when it has one. */
  href: string | null;
}

type Filter = "all" | "strength" | "run" | "incomplete";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "Todo" },
  { value: "strength", label: "Fuerza" },
  { value: "run", label: "Carrera" },
  { value: "incomplete", label: "Incompletas" },
];

function matches(entry: HistoryEntry, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "incomplete") return entry.incomplete;
  return entry.group === filter;
}

/**
 * The season's log. Filter, then tap a row open: the summary line is what
 * you scan, the grid underneath is what you check.
 */
export function HistoryLog({ entries }: { entries: HistoryEntry[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const visible = entries.filter((e) => matches(e, filter));

  // Nothing logged yet and nothing to filter: the chips would be furniture.
  if (entries.length === 0) {
    return (
      <RowStack className="mt-2.5">
        <Row>
          <p className="text-[12px] leading-[1.55] text-faint">
            Todavía no hay ninguna sesión registrada. En cuanto cierres la
            primera aparece aquí, con sus series y su tonelaje.
          </p>
        </Row>
      </RowStack>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-1.5 px-5 pt-3 pb-3">
        {FILTERS.map((f) => (
          <Chip
            key={f.value}
            active={filter === f.value}
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Chip>
        ))}
      </div>

      <RowStack>
        {visible.length === 0 ? (
          <Row>
            <p className="text-[12px] leading-[1.55] text-faint">
              Ninguna sesión de las registradas entra en este filtro.
            </p>
          </Row>
        ) : (
          visible.map((entry) => {
            const open = openId === entry.id;
            return (
              <div key={entry.id} className="flex flex-col gap-1.5">
                <SessionRow
                  accent={entry.accent}
                  title={entry.title}
                  subtitle={entry.subtitle}
                  status={entry.statusLabel}
                  statusTone={entry.statusTone}
                  primary={entry.headline}
                  secondary={entry.dateLabel}
                  muted={entry.status === "skipped"}
                  onClick={() => setOpenId(open ? null : entry.id)}
                />
                {open ? (
                  <div className="flex flex-col gap-2 rounded-xl border border-line bg-sunk px-3.5 py-3">
                    {entry.details.map((d) => (
                      <div key={d.label} className="flex items-baseline gap-3">
                        <span className="flex-1 text-[11px] leading-none tracking-[0.06em] text-faint uppercase">
                          {d.label}
                        </span>
                        <span className="num text-[13px] leading-none font-semibold">
                          {d.value}
                        </span>
                      </div>
                    ))}
                    {entry.href ? (
                      <Link
                        href={entry.href}
                        className="pt-1 text-[13px] leading-none font-medium text-lime"
                      >
                        {entry.group === "run" ? "ver carrera ›" : "ver resumen ›"}
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </RowStack>
    </>
  );
}
