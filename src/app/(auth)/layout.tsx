import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <div className="flex-none px-5 pt-6 pb-2">
        <div className="mx-auto w-full max-w-md">
          <div className="font-display text-[13px] leading-none font-bold tracking-[0.18em]">
            BLOQUES
          </div>
          <p className="font-display mt-2 text-[11px] leading-none font-semibold tracking-[0.12em] text-faint">
            ENTRENAMIENTO HÍBRIDO
          </p>
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-center px-5 py-8">
        <div className="mx-auto w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
