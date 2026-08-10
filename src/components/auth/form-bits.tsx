"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

export function Field({
  label,
  hint,
  className,
  ...rest
}: ComponentProps<"input"> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="font-display text-[10px] leading-none font-semibold tracking-[0.14em] text-mid uppercase">
        {label}
      </span>
      <input
        className={cn(
          "mt-2 h-12 w-full rounded-md border border-edge bg-surface px-3 text-[14px] font-medium text-ink",
          className,
        )}
        {...rest}
      />
      {hint ? (
        <span className="mt-1.5 block text-[11px] leading-[1.4] text-faint">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function SubmitBar({
  children,
  pendingLabel = "…",
}: {
  children: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="font-display flex h-14 w-full items-center justify-center rounded-xl bg-strength text-[14px] leading-none font-bold tracking-[0.1em] text-on-strength uppercase active:opacity-85 disabled:opacity-50"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export function Alert({
  tone,
  children,
}: {
  tone: "error" | "notice";
  children: string;
}) {
  return (
    <div
      className={cn(
        "rounded-r-sm border-l-[4px] py-1 pl-3 text-[12px] leading-[1.5]",
        tone === "error" ? "border-fail" : "border-ok",
      )}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
