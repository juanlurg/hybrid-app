"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";

import { signIn, type AuthState } from "@/lib/actions/auth";
import { Alert, Field, SubmitBar } from "@/components/auth/form-bits";

function SignInForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [state, action] = useActionState<AuthState, FormData>(signIn, {});

  return (
    <div>
      <h1 className="text-[32px] leading-[1] font-black tracking-[-0.03em]">
        Entrar
      </h1>
      <p className="mt-3 text-[12.5px] leading-[1.5] text-mid">
        El motor calcula el peso de cada sesión. Tú solo levantas.
      </p>

      <form action={action} className="mt-7 flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
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
          autoComplete="current-password"
          required
        />
        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        <SubmitBar pendingLabel="Entrando…">Entrar</SubmitBar>
      </form>

      <div className="mt-6 flex items-baseline justify-between text-[12px]">
        <Link href="/registro" className="font-semibold underline">
          Crear cuenta
        </Link>
        <Link href="/recuperar" className="text-mid underline">
          He olvidado la contraseña
        </Link>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
