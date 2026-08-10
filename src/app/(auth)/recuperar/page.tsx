"use client";

import Link from "next/link";
import { useActionState } from "react";

import { requestPasswordReset, type AuthState } from "@/lib/actions/auth";
import { Alert, Field, SubmitBar } from "@/components/auth/form-bits";

export default function RecoverPage() {
  const [state, action] = useActionState<AuthState, FormData>(
    requestPasswordReset,
    {},
  );

  return (
    <div>
      <h1 className="font-display text-[32px] leading-[1] font-bold tracking-[-0.02em]">
        Recuperar
      </h1>
      <p className="mt-3 text-[12.5px] leading-[1.5] text-mid">
        Te mandamos un enlace para poner una contraseña nueva.
      </p>

      <form action={action} className="mt-7 flex flex-col gap-4">
        <Field
          label="Correo"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.notice ? <Alert tone="notice">{state.notice}</Alert> : null}
        <SubmitBar pendingLabel="Enviando…">Enviar enlace</SubmitBar>
      </form>

      <div className="mt-6 text-[12px]">
        <Link href="/entrar" className="font-semibold underline">
          Volver a entrar
        </Link>
      </div>
    </div>
  );
}
