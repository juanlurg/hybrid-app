/**
 * The Bloques kit — Foco.
 *
 * One thing is lit per screen and everything else recedes into cards on
 * the page colour. Chakra Petch carries labels, numbers and actions;
 * Barlow carries prose. Every screen is built from these so the "one
 * lit thing" property survives contact with real data.
 */

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
    <div className={cn("flex items-baseline gap-3 px-5 pt-5", className)}>
      <span className="font-display flex-1 text-[12px] leading-none font-semibold tracking-[0.12em] text-mid uppercase">
        {children}
      </span>
      {right ? (
        <span className="text-[12.5px] leading-none font-normal text-faint">
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
      <div className="flex items-center gap-3">
        {/* Ellipsis, not a second line: `right` is often a control. */}
        <span className="font-display min-w-0 flex-1 truncate text-[12px] leading-none font-semibold tracking-[0.12em] text-mid uppercase">
          {eyebrow}
        </span>
        {right}
      </div>
      {title ? (
        <h1 className="font-display mt-2.5 text-[26px] leading-[1.1] font-bold">
          {title}
        </h1>
      ) : null}
      {subtitle ? (
        <p className="mt-1 text-[13px] leading-[1.45] text-mid">{subtitle}</p>
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
  const arrow = (
    <span aria-hidden className="text-[17px] leading-none text-mid">
      ←
    </span>
  );
  return (
    <div className="flex flex-none items-center gap-3 px-5 pt-6 pb-2">
      {href ? (
        <Link href={href} aria-label="Volver" className="cursor-pointer">
          {arrow}
        </Link>
      ) : (
        <button type="button" aria-label="Volver" onClick={onBack}>
          {arrow}
        </button>
      )}
      <span className="font-display flex-1 text-[13px] leading-none font-bold tracking-[0.1em] uppercase">
        {title}
      </span>
      {right ? (
        <span className="font-display text-[12px] leading-none text-faint">
          {right}
        </span>
      ) : null}
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
        "rounded-2xl border border-edge bg-surface px-5 py-5",
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
        "rounded-2xl border border-edge bg-surface px-4 py-3.5",
        className,
      )}
    >
      {children}
    </div>
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
          "num font-bold tracking-[-0.02em] text-lime",
          size === "lg"
            ? "text-[88px] leading-[0.95] sm:text-[108px]"
            : "text-[62px] leading-[0.95]",
        )}
      >
        {value}
      </span>
      <span className="num text-[19px] leading-none font-semibold text-mid uppercase">
        {unit}
      </span>
      {lines ? (
        <span className="ml-auto text-right text-[12.5px] leading-[1.5] text-mid">
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
        "grid gap-1.5 px-5 pt-3",
        columns === 2 && "grid-cols-2",
        columns === 3 && "grid-cols-3",
        columns === 4 && "grid-cols-2 sm:grid-cols-4",
      )}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg border border-line bg-surface px-4 py-3.5"
        >
          <div className="flex items-baseline gap-1.5">
            <span
              className={cn(
                "num text-[28px] leading-none font-bold tracking-[-0.02em]",
                item.tone,
              )}
            >
              {item.value}
            </span>
            {item.unit ? (
              <span className="text-[12px] leading-none font-medium text-mid">
                {item.unit}
              </span>
            ) : null}
          </div>
          <div className="font-display mt-2 text-[10px] leading-none font-semibold tracking-[0.12em] text-faint uppercase">
            {item.label}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── rows ────────────────────────────────────────────────────── */

/** A stack of cards. The page shows through the gap. */
export function RowStack({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5 px-5", className)}>{children}</div>
  );
}

export function Row({ children, className, ...rest }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface px-3.5 py-3",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Coloured spine + title/subtitle + right-hand figures. */
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
  className,
}: {
  accent: string;
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
      <div
        className="h-8 w-[3px] flex-none rounded-full"
        style={{ background: accent }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "truncate text-[15px] leading-[1.2] font-semibold",
              muted && "text-faint",
            )}
          >
            {title}
          </span>
          {status ? (
            <span
              className={cn(
                "font-display flex-none text-[9.5px] leading-none font-semibold tracking-[0.1em]",
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
              "mt-0.5 truncate text-[12.5px] leading-[1.35]",
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
                "num text-[14px] leading-none font-semibold",
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
    "block rounded-xl border border-line bg-surface px-3.5 py-3",
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
        "font-display rounded-sm border px-2.5 py-2 text-[12px] leading-none font-semibold",
        active
          ? "border-transparent bg-strength text-on-strength"
          : "border-edge bg-soft text-ink",
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
        "font-display rounded-sm border border-edge bg-soft px-2.5 py-[7px] text-[12px] leading-none font-semibold",
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
        "flex gap-1 rounded-md border border-edge bg-soft p-1",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "font-display flex-1 rounded-sm px-1 py-2.5 text-[11px] leading-none font-semibold tracking-[0.08em] uppercase",
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
    "flex h-8 w-8 items-center justify-center rounded-sm border border-edge bg-surface text-[15px] leading-none text-mid";
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
          "num flex h-8 items-center justify-center rounded-sm border border-edge bg-surface px-2.5 text-[14px] leading-none font-semibold",
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
        "flex h-[26px] w-12 flex-none items-center rounded-full border p-0.5 transition-colors",
        checked ? "border-transparent bg-strength" : "border-edge bg-soft",
      )}
    >
      <span
        className={cn(
          "h-[18px] w-[18px] rounded-full transition-[margin] duration-100",
          checked ? "ml-[22px] bg-on-strength" : "ml-0 bg-hairline",
        )}
      />
    </button>
  );
}

/* ── actions ─────────────────────────────────────────────────── */

const BAR =
  "font-display flex h-15 w-full items-center justify-center gap-3 rounded-xl text-[16px] leading-none font-bold tracking-[0.06em] uppercase active:opacity-85 disabled:opacity-40";

function barTone(tone: "ink" | "strength" | "run") {
  return tone === "strength"
    ? "bg-strength text-on-strength"
    : tone === "run"
      ? "bg-run text-on-run"
      : "bg-panel text-on-panel";
}

/** The action at the bottom of a screen. Inset, not full-bleed. */
export function ActionBar({
  children,
  tone = "strength",
  className,
  ...rest
}: ComponentProps<"button"> & { tone?: "ink" | "strength" | "run" }) {
  return (
    <div className={cn("flex-none px-5 pt-3.5 pb-3", className)}>
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
    <div className={cn("flex-none px-5 pt-3.5 pb-3", className)}>
      <Link href={href} className={cn(BAR, barTone(tone))}>
        {children}
      </Link>
    </div>
  );
}

/* ── notes ───────────────────────────────────────────────────── */

/** The engine talking. In light it inverts; in dark it is a card. */
export function Callout({
  eyebrow,
  eyebrowTone = "text-warn-panel",
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
        "rounded-2xl border border-edge bg-panel px-4 py-3.5 text-on-panel",
        className,
      )}
    >
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "font-display text-[11px] leading-none font-semibold tracking-[0.14em] uppercase",
            eyebrowTone,
          )}
        >
          {eyebrow}
        </span>
        {action ? <span className="ml-auto">{action}</span> : null}
      </div>
      <div className="mt-2 text-[12.5px] leading-[1.5] opacity-75">
        {children}
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
      <div className="font-display text-[11.5px] leading-[1.2] font-bold tracking-[0.05em] uppercase">
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
    <p className="px-5 py-4 text-[12.5px] leading-[1.5] text-faint">
      {children}
    </p>
  );
}

/*
 * The plate breakdown is no longer a component: Hoy renders it as a `Tag`
 * and the runner gives it its own labelled row under the hero.
 */
