/**
 * The Bloques kit.
 *
 * Hard rules, full-bleed colour, heavy type. Every screen is built from
 * these so the "readable from a metre away" property survives contact
 * with real data.
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
    <div className={cn("flex items-baseline gap-3 px-4 pt-5", className)}>
      <span className="flex-1 text-[10px] leading-none font-extrabold tracking-[0.14em] text-mid uppercase">
        {children}
      </span>
      {right ? (
        <span className="text-[10px] leading-none font-medium text-ghost">
          {right}
        </span>
      ) : null}
    </div>
  );
}

/** The black band at the top of every screen. */
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
    <header className={cn("flex-none bg-ink px-4 pt-4 pb-4 text-paper", className)}>
      <div className="flex items-baseline gap-3">
        <span className="flex-1 text-[11px] leading-none font-extrabold tracking-[0.14em] uppercase">
          {eyebrow}
        </span>
        {right}
      </div>
      {title ? (
        <h1 className="mt-3 text-[26px] leading-[1.02] font-black tracking-[-0.03em]">
          {title}
        </h1>
      ) : null}
      {subtitle ? (
        <p className="mt-2 text-[11.5px] leading-none font-medium opacity-55">
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
  const arrow = (
    <span aria-hidden className="text-[17px] leading-none font-medium">
      ←
    </span>
  );
  return (
    <div className="flex flex-none items-center gap-3 bg-ink px-4 py-3 text-paper">
      {href ? (
        <Link href={href} aria-label="Volver" className="cursor-pointer">
          {arrow}
        </Link>
      ) : (
        <button type="button" aria-label="Volver" onClick={onBack}>
          {arrow}
        </button>
      )}
      <span className="flex-1 text-[11px] leading-none font-extrabold tracking-[0.1em] uppercase">
        {title}
      </span>
      {right ? (
        <span className="text-[11px] leading-none font-medium opacity-60">
          {right}
        </span>
      ) : null}
    </div>
  );
}

/* ── numbers ─────────────────────────────────────────────────── */

/** The 100px headline number with its unit stack. */
export function HeroNumber({
  value,
  unit,
  lines,
  size = "lg",
}: {
  value: ReactNode;
  unit: string;
  lines?: ReactNode;
  size?: "lg" | "md";
}) {
  return (
    <div className="mt-2 flex items-start gap-2.5">
      <div
        className={cn(
          "num font-black tracking-[-0.055em]",
          size === "lg"
            ? "text-[86px] leading-[0.76] sm:text-[106px]"
            : "text-[62px] leading-[0.8]",
        )}
      >
        {value}
      </div>
      <div className="pt-2">
        <div className="text-[20px] leading-none font-extrabold uppercase">
          {unit}
        </div>
        {lines ? (
          <div className="mt-2 text-[13px] leading-[1.25] font-semibold opacity-75">
            {lines}
          </div>
        ) : null}
      </div>
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
        "mt-px grid gap-px bg-line",
        columns === 2 && "grid-cols-2",
        columns === 3 && "grid-cols-3",
        columns === 4 && "grid-cols-2 sm:grid-cols-4",
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="bg-paper px-4 py-3.5">
          <div className="flex items-baseline gap-1.5">
            <span
              className={cn(
                "num text-[30px] leading-none font-black tracking-[-0.035em]",
                item.tone,
              )}
            >
              {item.value}
            </span>
            {item.unit ? (
              <span className="text-[12px] leading-none font-bold text-mid">
                {item.unit}
              </span>
            ) : null}
          </div>
          <div className="mt-2 text-[9.5px] leading-none font-semibold tracking-[0.12em] text-mid uppercase">
            {item.label}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── rows ────────────────────────────────────────────────────── */

/** A hairline-separated stack. Gap is the rule. */
export function RowStack({
  children,
  bordered = true,
  className,
}: {
  children: ReactNode;
  bordered?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-px bg-line",
        bordered && "border-y-2 border-ink",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Row({
  children,
  className,
  ...rest
}: ComponentProps<"div">) {
  return (
    <div className={cn("bg-paper px-4 py-3", className)} {...rest}>
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
    <div className="flex w-full items-center gap-2.5 text-left">
      <div className="h-9 w-1.5 flex-none" style={{ background: accent }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              "truncate text-[13.5px] leading-[1.2] font-bold",
              muted && "text-ghost",
            )}
          >
            {title}
          </span>
          {status ? (
            <span
              className={cn(
                "flex-none text-[9.5px] leading-none font-semibold tracking-[0.1em]",
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
              "mt-1 truncate text-[11px] leading-[1.35] font-normal",
              muted ? "text-hairline" : "text-mid",
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
                "num text-[12.5px] leading-none font-extrabold",
                muted && "text-ghost",
              )}
            >
              {primary}
            </div>
          ) : null}
          {secondary ? (
            <div
              className={cn(
                "mt-1 text-[9.5px] leading-none font-medium",
                muted ? "text-hairline" : "text-mid",
              )}
            >
              {secondary}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const classes = cn("block bg-paper px-4 py-3", className);
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
        "border-2 border-ink px-2.5 py-2 text-[10px] leading-none font-bold tracking-[0.06em] uppercase",
        active ? "bg-ink text-paper" : "bg-transparent text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Flush segmented control — the tab strip pattern. */
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
    <div className={cn("flex gap-px bg-line py-px", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 px-1 py-3 text-[11px] leading-none font-bold tracking-[0.08em] uppercase",
            value === o.value ? "bg-ink text-paper" : "bg-paper text-mid",
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
  return (
    <div className="flex flex-none items-center gap-px">
      <button
        type="button"
        aria-label={label ? `Bajar ${label}` : "Bajar"}
        onClick={onDecrement}
        className="flex h-8 w-8 items-center justify-center bg-ink text-[16px] leading-none font-bold text-paper"
      >
        −
      </button>
      <div
        className={cn(
          "num flex h-8 items-center justify-center bg-soft px-1.5 text-[13px] leading-none font-extrabold",
          compact ? "min-w-8" : "min-w-[58px]",
        )}
      >
        {value}
      </div>
      <button
        type="button"
        aria-label={label ? `Subir ${label}` : "Subir"}
        onClick={onIncrement}
        className="flex h-8 w-8 items-center justify-center bg-ink text-[16px] leading-none font-bold text-paper"
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
        "flex h-[26px] w-12 flex-none items-center border-2 border-ink p-0.5",
        checked ? "bg-strength" : "bg-transparent",
      )}
    >
      <span
        className={cn(
          "h-[18px] w-[18px] transition-[margin] duration-100",
          checked ? "ml-[22px] bg-ink" : "ml-0 bg-hairline",
        )}
      />
    </button>
  );
}

/** The full-width action bar at the bottom of a screen. */
export function ActionBar({
  children,
  tone = "ink",
  className,
  ...rest
}: ComponentProps<"button"> & { tone?: "ink" | "strength" | "run" }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-16 w-full flex-none items-center justify-center gap-3 text-[16px] leading-none font-extrabold tracking-[0.1em] uppercase active:opacity-85 disabled:opacity-40",
        tone === "ink" && "bg-ink text-paper",
        tone === "strength" && "bg-strength text-ink",
        tone === "run" && "bg-run text-paper",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function LinkBar({
  href,
  children,
  tone = "ink",
  className,
}: {
  href: string;
  children: ReactNode;
  tone?: "ink" | "strength" | "run";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex h-16 w-full flex-none items-center justify-center gap-3 text-[16px] leading-none font-extrabold tracking-[0.1em] uppercase active:opacity-85",
        tone === "ink" && "bg-ink text-paper",
        tone === "strength" && "bg-strength text-ink",
        tone === "run" && "bg-run text-paper",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/* ── notes ───────────────────────────────────────────────────── */

/** Black box with a coloured eyebrow — the engine talking. */
export function Callout({
  eyebrow,
  eyebrowTone = "text-warn",
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
    <div className={cn("bg-ink px-3.5 py-3.5 text-paper", className)}>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "text-[10px] leading-none font-extrabold tracking-[0.12em] uppercase",
            eyebrowTone,
          )}
        >
          {eyebrow}
        </span>
        {action ? <span className="ml-auto">{action}</span> : null}
      </div>
      <div className="mt-2 text-[11.5px] leading-[1.5] font-normal opacity-75">
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
    <div className="border-l-[6px] py-0.5 pl-3" style={{ borderColor: tone }}>
      <div className="text-[11px] leading-[1.2] font-extrabold tracking-[0.05em] uppercase">
        {title}
      </div>
      {children ? (
        <div className="mt-1.5 text-[11.5px] leading-[1.5] text-mid">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function Footnote({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 py-4 text-[11px] leading-[1.5] text-faint">{children}</p>
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
    <div className={cn("border-2 border-ink px-3.5 py-3.5", className)}>
      {children}
    </div>
  );
}

/* ── plates ──────────────────────────────────────────────────── */

export function PlateChips({
  plates,
  remainder,
  tone = "ink",
}: {
  plates: number[];
  remainder?: number;
  tone?: "ink" | "paper";
}) {
  if (plates.length === 0 && !remainder) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {plates.map((p, i) => (
        <span
          key={`${p}-${i}`}
          className={cn(
            "num border-[1.5px] px-1.5 py-1 text-[11px] leading-none font-bold",
            tone === "ink" ? "border-ink" : "border-paper",
          )}
        >
          {String(p).replace(".", ",")}
        </span>
      ))}
      {remainder ? (
        <span className="text-[10px] leading-none font-semibold text-fail">
          +{String(remainder).replace(".", ",")} sin disco
        </span>
      ) : null}
    </div>
  );
}
