/**
 * The Bloques kit — the notebook.
 *
 * Warm paper, cards that float on soft shadows, one dark panel per screen
 * for the thing that matters now. Plus Jakarta Sans throughout. Every
 * screen is built from these so the "one lit thing" property survives
 * contact with real data.
 */

import { ChevronDown, ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

/* ── labels and headers ──────────────────────────────────────── */

export function SectionLabel({
  children,
  right,
  className,
}: {
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline gap-2 px-5 pt-6", className)}>
      <span className="flex-1 text-[17px] leading-tight font-extrabold tracking-[-0.01em] text-ink">
        {children}
      </span>
      {right ? (
        <span className="text-[13px] leading-none font-semibold text-mid">
          {right}
        </span>
      ) : null}
    </div>
  );
}

/** The top of every screen: eyebrow, title, one line of context. */
export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  right,
  children,
  className,
}: {
  eyebrow: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex-none px-5 pt-6 pb-1", className)}>
      <div className="flex min-h-[30px] items-center gap-3">
        {/* Ellipsis, not a second line: `right` is often a control. */}
        <span className="min-w-0 flex-1 truncate text-[11px] leading-none font-bold tracking-[0.13em] text-clay uppercase">
          {eyebrow}
        </span>
        {right}
      </div>
      {title ? (
        <h1 className="mt-2 text-[32px] leading-[1.1] font-extrabold tracking-[-0.02em]">
          {title}
        </h1>
      ) : null}
      {subtitle ? (
        <p className="mt-1.5 text-[14px] leading-[1.45] font-medium text-body">
          {subtitle}
        </p>
      ) : null}
      {children}
    </header>
  );
}

/** Compact bar with a back arrow, for pushed screens. */
export function TopBar({
  title,
  href,
  right,
  onBack,
}: {
  title: string;
  href?: string;
  right?: ReactNode;
  onBack?: () => void;
}) {
  const arrow = <ChevronLeft aria-hidden size={18} strokeWidth={2.25} />;
  const hit =
    "flex h-10 w-10 flex-none items-center justify-center rounded-full bg-surface text-ink shadow-raised";
  return (
    <div className="flex flex-none items-center gap-3 px-4 pt-4 pb-2">
      {href ? (
        <Link href={href} aria-label="Volver" className={cn(hit, "cursor-pointer")}>
          {arrow}
        </Link>
      ) : (
        <button type="button" aria-label="Volver" onClick={onBack} className={hit}>
          {arrow}
        </button>
      )}
      <span className="min-w-0 flex-1 truncate text-center text-[15px] leading-tight font-extrabold">
        {title}
      </span>
      {/* Keeps the title centred when there is nothing on the right. */}
      <span className="flex min-w-10 flex-none justify-end text-[12.5px] leading-none font-semibold text-mid">
        {right}
      </span>
    </div>
  );
}

/* ── surfaces ────────────────────────────────────────────────── */

/** The card. Everything that is not the page sits in one of these. */
export function Card({
  children,
  className,
  ...rest
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-3xl bg-surface px-5 py-5 shadow-card",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Outlined box used for secondary panels. */
export function Framed({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-surface px-4 py-3.5 shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A reference block folded behind its own summary. `details` keeps the body
 * mounted, so anything stateful inside survives an open/close.
 */
export function Fold({
  title,
  summary,
  children,
  className,
}: {
  title: string;
  summary: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details
      className={cn(
        "group mx-5 rounded-2xl bg-surface shadow-card",
        className,
      )}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] leading-tight font-bold">
            {title}
          </span>
          <span className="mt-1 block text-[12.5px] leading-[1.35] font-medium text-mid">
            {summary}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          size={18}
          className="flex-none text-faint transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="rounded-b-2xl border-t border-line px-4 pt-3.5 pb-4">
        {children}
      </div>
    </details>
  );
}

/* ── numbers ─────────────────────────────────────────────────── */

/** The lit number. There is one of these per screen, and only one. */
export function HeroNumber({
  value,
  unit,
  lines,
  size = "lg",
}: {
  value: ReactNode;
  unit: string;
  /** A quiet caption beside the number — never data the set depends on. */
  lines?: ReactNode;
  size?: "lg" | "md";
}) {
  return (
    <div className="mt-2 flex items-baseline gap-2.5">
      <span
        className={cn(
          "num font-extrabold tracking-[-0.04em] text-clay",
          size === "lg"
            ? "text-[88px] leading-[0.9] sm:text-[104px]"
            : "text-[62px] leading-[0.95]",
        )}
      >
        {value}
      </span>
      <span className="text-[20px] leading-none font-bold text-mid">
        {unit}
      </span>
      {lines ? (
        <span className="ml-auto text-right text-[12.5px] leading-[1.5] font-medium text-mid">
          {lines}
        </span>
      ) : null}
    </div>
  );
}

export function StatGrid({
  items,
  columns = 2,
}: {
  items: Array<{ value: ReactNode; unit?: string; label: string; tone?: string }>;
  columns?: 2 | 3 | 4;
}) {
  return (
    <div
      className={cn(
        "grid gap-2 px-5 pt-3",
        columns === 2 && "grid-cols-2",
        columns === 3 && "grid-cols-3",
        columns === 4 && "grid-cols-2 sm:grid-cols-4",
      )}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-xl bg-surface p-3.5 shadow-raised"
        >
          <div className="flex items-baseline gap-1">
            <span
              className={cn(
                "num text-[26px] leading-none font-extrabold tracking-[-0.02em]",
                item.tone,
              )}
            >
              {item.value}
            </span>
            {item.unit ? (
              <span className="text-[13px] leading-none font-bold text-mid">
                {item.unit}
              </span>
            ) : null}
          </div>
          <div className="mt-1.5 text-[12px] leading-[1.3] font-semibold text-mid">
            {item.label}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── rows ────────────────────────────────────────────────────── */

/** One card, rows inside it. Rows are padded hit areas, not boxes. */
export function RowStack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-5 flex flex-col gap-0.5 rounded-2xl bg-surface p-1.5 shadow-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Row({ children, className, ...rest }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-lg px-2.5 py-2.5", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Coloured tile (icon) or spine + title/subtitle + right-hand figures. */
export function SessionRow({
  accent,
  title,
  subtitle,
  primary,
  secondary,
  status,
  statusTone,
  muted,
  onClick,
  href,
  icon,
  className,
}: {
  accent: string;
  /** Replaces the spine with a tinted tile holding this icon. */
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  primary?: ReactNode;
  secondary?: ReactNode;
  status?: string;
  statusTone?: string;
  muted?: boolean;
  onClick?: () => void;
  href?: string;
  className?: string;
}) {
  const body = (
    <div className="flex w-full items-center gap-3 text-left">
      {icon ? (
        <span
          className="flex h-9 w-9 flex-none items-center justify-center rounded-md"
          style={{
            color: accent,
            background: `color-mix(in srgb, ${accent} 14%, var(--surface))`,
          }}
        >
          {icon}
        </span>
      ) : (
        <div
          className="h-8 w-1 flex-none rounded-full"
          style={{ background: accent }}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "truncate text-[15px] leading-[1.25] font-bold",
              muted && "font-semibold text-mid",
            )}
          >
            {title}
          </span>
          {status ? (
            <span
              className={cn(
                "flex-none text-[11px] leading-none font-bold",
                statusTone,
              )}
            >
              {status}
            </span>
          ) : null}
        </div>
        {subtitle ? (
          <div
            className={cn(
              "mt-0.5 truncate text-[12.5px] leading-[1.35] font-medium",
              muted ? "text-faint" : "text-mid",
            )}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
      {primary || secondary ? (
        <div className="flex-none text-right">
          {primary ? (
            <div
              className={cn(
                "num text-[15px] leading-none font-bold",
                muted && "text-faint",
              )}
            >
              {primary}
            </div>
          ) : null}
          {secondary ? (
            <div
              className={cn(
                "mt-1 text-[11px] leading-none",
                muted ? "text-faint" : "text-mid",
              )}
            >
              {secondary}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const classes = cn(
    "block rounded-lg px-2.5 py-2.5",
    className,
  );
  if (href) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(classes, "w-full")}>
        {body}
      </button>
    );
  }
  return <div className={classes}>{body}</div>;
}

/* ── controls ────────────────────────────────────────────────── */

export function Chip({
  active,
  children,
  className,
  ...rest
}: ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-full px-3.5 py-2.5 text-[13px] leading-none font-bold",
        active
          ? "bg-strength text-on-strength"
          : "bg-soft text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Read-only chip — the prescription facts under the lit number. */
export function Tag({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex h-8 items-center rounded-full bg-soft px-3 text-[13px] leading-none font-bold",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Segmented control — the tab strip pattern. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex gap-1 rounded-full bg-soft p-1",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded-full px-1 py-2.5 text-[13px] leading-none font-bold",
            value === o.value
              ? "bg-strength text-on-strength"
              : "bg-transparent text-mid",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  onDecrement,
  onIncrement,
  label,
  compact,
}: {
  value: ReactNode;
  onDecrement: () => void;
  onIncrement: () => void;
  label?: string;
  compact?: boolean;
}) {
  const button =
    "flex h-9 w-9 items-center justify-center rounded-full bg-soft text-[17px] leading-none font-bold text-ink";
  return (
    <div className="flex flex-none items-center gap-1">
      <button
        type="button"
        aria-label={label ? `Bajar ${label}` : "Bajar"}
        onClick={onDecrement}
        className={button}
      >
        −
      </button>
      <div
        className={cn(
          "num flex h-9 items-center justify-center px-1.5 text-[15px] leading-none font-extrabold",
          compact ? "min-w-8" : "min-w-[58px]",
        )}
      >
        {value}
      </div>
      <button
        type="button"
        aria-label={label ? `Subir ${label}` : "Subir"}
        onClick={onIncrement}
        className={button}
      >
        +
      </button>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-7 w-12 flex-none items-center rounded-full p-0.5 transition-colors",
        checked ? "bg-strength" : "bg-quiet",
      )}
    >
      <span
        className={cn(
          "h-6 w-6 rounded-full bg-surface shadow-raised transition-[margin] duration-100",
          checked ? "ml-5" : "ml-0",
        )}
      />
    </button>
  );
}

/* ── actions ─────────────────────────────────────────────────── */

const BAR =
  "flex h-14 w-full items-center justify-center gap-2.5 rounded-xl text-[16px] leading-none font-bold active:opacity-85 disabled:opacity-40 disabled:shadow-none";

function barTone(tone: "ink" | "strength" | "run") {
  return tone === "strength"
    ? "bg-strength text-on-strength shadow-cta"
    : tone === "run"
      ? "bg-run text-on-run shadow-cta-run"
      : "bg-panel text-on-panel shadow-panel";
}

/** The action at the bottom of a screen. Inset, not full-bleed. */
export function ActionBar({
  children,
  tone = "strength",
  className,
  ...rest
}: ComponentProps<"button"> & { tone?: "ink" | "strength" | "run" }) {
  return (
    <div className={cn("flex-none px-4 pt-3.5 pb-3", className)}>
      <button type="button" className={cn(BAR, barTone(tone))} {...rest}>
        {children}
      </button>
    </div>
  );
}

export function LinkBar({
  href,
  children,
  tone = "strength",
  className,
}: {
  href: string;
  children: ReactNode;
  tone?: "ink" | "strength" | "run";
  className?: string;
}) {
  return (
    <div className={cn("flex-none px-4 pt-3.5 pb-3", className)}>
      <Link href={href} className={cn(BAR, barTone(tone))}>
        {children}
      </Link>
    </div>
  );
}

/* ── notes ───────────────────────────────────────────────────── */

/** The engine talking: the dark panel, a coloured eyebrow. */
export function Callout({
  eyebrow,
  eyebrowTone = "text-clay-panel",
  children,
  action,
  className,
}: {
  eyebrow: string;
  eyebrowTone?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-3xl bg-panel px-5 py-4 text-on-panel shadow-panel",
        className,
      )}
    >
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "text-[11px] leading-none font-bold tracking-[0.13em] uppercase",
            eyebrowTone,
          )}
        >
          {eyebrow}
        </span>
        {action ? <span className="ml-auto">{action}</span> : null}
      </div>
      <div className="mt-2 text-[13px] leading-[1.5] font-medium text-white/75">
        {children}
      </div>
    </div>
  );
}

const NOTE_TONE = {
  warn: "bg-warn-soft text-clay-dim",
  clay: "bg-clay-soft text-clay",
  run: "bg-run-soft text-run",
  quiet: "bg-quiet text-mid",
} as const;

/** A note on the page: a tinted icon tile, a bold line, one sentence. */
export function Note({
  icon,
  tone = "warn",
  title,
  children,
  action,
  className,
}: {
  icon: ReactNode;
  tone?: keyof typeof NOTE_TONE;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl bg-surface px-4 py-3.5 shadow-card",
        className,
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 flex-none items-center justify-center rounded-md",
          NOTE_TONE[tone],
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="flex-1 text-[14px] leading-[1.3] font-bold">
            {title}
          </span>
          {action}
        </div>
        {children ? (
          <div className="mt-1 text-[13px] leading-[1.45] font-medium text-mid">
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A left-ruled warning, used by the plan validator. */
export function RuleNote({
  tone,
  title,
  children,
}: {
  tone: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      className="rounded-r-sm border-l-[4px] py-0.5 pl-3"
      style={{ borderColor: tone }}
    >
      <div className="text-[14px] leading-[1.3] font-bold">
        {title}
      </div>
      {children ? (
        <div className="mt-1.5 text-[12.5px] leading-[1.5] text-mid">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function Footnote({ children }: { children: ReactNode }) {
  return (
    <p className="px-6 py-4 text-[12.5px] leading-[1.5] font-medium text-mid">
      {children}
    </p>
  );
}

/*
 * The plate breakdown is no longer a component: Hoy renders it as a `Tag`
 * and the runner gives it its own labelled row under the hero.
 */
