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
      <span className="text-[10px] leading-none font-extrabold tracking-[0.14em] text-mid uppercase">
        {label}
      </span>
      <input
        className={cn(
          "mt-2 h-12 w-full border-2 border-ink bg-paper px-3 text-[14px] font-medium outline-none",
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
      className="flex h-14 w-full items-center justify-center bg-ink text-[14px] leading-none font-extrabold tracking-[0.1em] text-paper uppercase active:opacity-85 disabled:opacity-50"
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
        "border-l-[6px] py-1 pl-3 text-[12px] leading-[1.5]",
        tone === "error" ? "border-fail" : "border-ok",
      )}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
