"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signUp, type AuthState } from "@/lib/actions/auth";
import { Alert, Field, SubmitBar } from "@/components/auth/form-bits";

export default function SignUpPage() {
  const [state, action] = useActionState<AuthState, FormData>(signUp, {});

  return (
    <div>
      <h1 className="font-display text-[32px] leading-[1] font-bold tracking-[-0.02em]">
        Crear cuenta
      </h1>
      <p className="mt-3 text-[12.5px] leading-[1.5] text-mid">
        Empiezas con el Plan Maestro y lo haces tuyo desde el primer día.
      </p>

      <form action={action} className="mt-7 flex flex-col gap-4">
        <Field label="Nombre" name="display_name" autoComplete="name" />
        <Field
          label="Correo"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
        <Field
          label="Contraseña"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          hint="Mínimo 8 caracteres."
        />
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.notice ? <Alert tone="notice">{state.notice}</Alert> : null}
        <SubmitBar pendingLabel="Creando…">Crear cuenta</SubmitBar>
      </form>

      <div className="mt-6 text-[12px]">
        <Link href="/entrar" className="font-semibold underline">
          Ya tengo cuenta
        </Link>
      </div>
    </div>
  );
}
