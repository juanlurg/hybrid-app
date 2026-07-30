import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <div className="flex-none bg-ink px-5 py-5 text-paper">
        <div className="mx-auto w-full max-w-md">
          <div className="text-[11px] leading-none font-extrabold tracking-[0.18em]">
            BLOQUES
          </div>
          <p className="mt-2 text-[11px] leading-none font-medium opacity-50">
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
