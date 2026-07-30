"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/cn";
import {
  applyProposal,
  discardProposal,
  proposeChanges,
  undoProposal,
  type ProposalView,
} from "@/lib/actions/ai";

export interface ThreadMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

const SUGGESTIONS = [
  "Los miércoles solo tengo 45 minutos, no me cabe la sesión entera.",
  "Me molesta el hombro derecho en el press militar.",
  "Quiero subir el hip thrust sin perder la carrera.",
  "Esta semana viajo y solo tengo mancuernas.",
];

export function AiPanel({
  open,
  onClose,
  hasApiKey,
  initialMessages,
  initialThreadId,
  initialProposal,
  lastApplied,
}: {
  open: boolean;
  onClose: () => void;
  hasApiKey: boolean;
  initialMessages: ThreadMessage[];
  initialThreadId: string | null;
  initialProposal: ProposalView | null;
  lastApplied: { id: string; count: number } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [threadId, setThreadId] = useState(initialThreadId);
  const [proposal, setProposal] = useState<ProposalView | null>(initialProposal);
  const [accepted, setAccepted] = useState<Set<number>>(
    () => new Set(initialProposal?.changes.map((_, i) => i) ?? []),
  );
  const [applied, setApplied] = useState(lastApplied);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [open, messages.length, proposal, thinking]);

  function ask(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setDraft("");
    setError(null);
    setProposal(null);
    setApplied(null);
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setThinking(true);

    startTransition(async () => {
      const res = await proposeChanges(q, threadId ?? undefined);
      setThinking(false);
      if (!res.ok || !res.proposal) {
        setError(res.error ?? "No se ha podido consultar a la IA.");
        return;
      }
      setThreadId(res.threadId ?? threadId);
      setProposal(res.proposal);
      setAccepted(new Set(res.proposal.changes.map((_, i) => i)));
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.proposal!.rationale },
      ]);
    });
  }

  const acceptedCount = accepted.size;

  return (
    <>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="fixed inset-0 z-40 bg-ink/55"
          />
          <div className="animate-rise fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col border-t-[3px] border-ink bg-paper md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[420px] md:border-t-0 md:border-l-[3px]">
            <div className="flex flex-none items-center gap-2.5 bg-ink px-4 py-3.5 text-paper">
              <span className="h-[18px] w-[18px] bg-strength" />
              <span className="flex-1 text-[11px] leading-none font-extrabold tracking-[0.12em] uppercase">
                Refinar con IA
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
                className="text-[17px] leading-none font-medium opacity-60"
              >
                ×
              </button>
            </div>

            <div
              ref={scroller}
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-3.5"
            >
              {!hasApiKey ? (
                <div className="border-l-[6px] border-warn py-1 pl-3 text-[12px] leading-[1.55]">
                  Falta <code className="font-bold">GEMINI_API_KEY</code> en{" "}
                  <code className="font-bold">.env.local</code>. Consíguela en
                  aistudio.google.com/apikey, añádela y reinicia el servidor. El
                  resto del editor funciona sin ella.
                </div>
              ) : null}

              {messages.length === 0 && !thinking ? (
                <p className="text-[12px] leading-[1.55] text-mid">
                  Cuéntame qué te pasa con el plan: tiempo, una molestia o un
                  objetivo. Te propongo un diff concreto y tú decides qué entra.
                  Los pesos no los toco — los calcula el motor con tus RM.
                </p>
              ) : null}

              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "max-w-[88%]",
                    m.role === "user"
                      ? "self-end bg-ink px-3.5 py-3 text-[12.5px] leading-[1.45] font-medium text-paper"
                      : "self-start border-l-4 border-strength py-0.5 pl-3.5 text-[12.5px] leading-[1.55]",
                  )}
                >
                  {m.content}
                </div>
              ))}

              {thinking ? (
                <div className="flex items-center gap-2 text-mid">
                  <span className="animate-pulse-block h-2.5 w-2.5 bg-strength" />
                  <span className="text-[11px] leading-none font-semibold tracking-[0.06em] uppercase">
                    Leyendo tu plan…
                  </span>
                </div>
              ) : null}

              {error ? (
                <div className="border-l-[6px] border-fail py-1 pl-3 text-[12px] leading-[1.5]">
                  {error}
                </div>
              ) : null}

              {proposal &&
              (proposal.changes.length > 0 || proposal.dropped.length > 0) ? (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] leading-none font-extrabold tracking-[0.14em] uppercase">
                      Cambios propuestos
                    </span>
                    <span className="ml-auto text-[10px] leading-none font-medium text-faint">
                      {acceptedCount} de {proposal.changes.length} aceptados
                    </span>
                  </div>
                  {proposal.changes.map((c, i) => {
                    const on = accepted.has(i);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() =>
                          setAccepted((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i);
                            else next.add(i);
                            return next;
                          })
                        }
                        className={cn(
                          "flex gap-3 border-2 px-3 py-3 text-left",
                          on ? "border-ink bg-tint" : "border-quiet bg-paper",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-5 w-5 flex-none items-center justify-center border-2 border-ink text-[11px] leading-none font-extrabold text-paper",
                            on && "bg-ink",
                          )}
                        >
                          {on ? "✓" : ""}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] leading-[1.3] font-bold">
                            {c.title}
                          </span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px] leading-[1.3] font-semibold">
                            <span className="text-faint line-through">
                              {c.from || "—"}
                            </span>
                            <span className="text-faint">→</span>
                            <span>{c.to || "—"}</span>
                          </span>
                          {c.why ? (
                            <span className="mt-2 block text-[11px] leading-[1.45] text-mid">
                              {c.why}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                  {proposal.dropped.map((d, i) => (
                    <div
                      key={`dropped-${i}`}
                      className="flex gap-3 border-2 border-dashed border-hairline bg-paper px-3 py-3"
                    >
                      <span className="flex h-5 w-5 flex-none items-center justify-center border-2 border-hairline text-[11px] leading-none font-extrabold text-ghost">
                        ×
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] leading-[1.3] font-bold text-ghost line-through">
                          {d.op.title}
                        </span>
                        <span className="mt-1.5 block text-[11px] leading-[1.45] text-mid">
                          Las reglas lo dejan fuera: {d.reason}.
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}

              {applied ? (
                <div className="flex items-center gap-2.5 border-2 border-ink px-3 py-3">
                  <span className="text-[11px] leading-none font-extrabold tracking-[0.06em] text-ok uppercase">
                    ✓ {applied.count}{" "}
                    {applied.count === 1
                      ? "cambio aplicado al plan"
                      : "cambios aplicados al plan"}
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const res = await undoProposal(applied.id);
                        if (!res.ok) {
                          setError(res.error ?? "No se ha podido deshacer.");
                          return;
                        }
                        setApplied(null);
                        setMessages((prev) => [
                          ...prev,
                          {
                            role: "assistant",
                            content: "Deshecho. El plan vuelve a como estaba.",
                          },
                        ]);
                        router.refresh();
                      })
                    }
                    className="ml-auto text-[11px] leading-none font-medium text-mid underline"
                  >
                    deshacer
                  </button>
                </div>
              ) : null}
            </div>

            {proposal && proposal.changes.length > 0 ? (
              <div className="flex flex-none">
                <button
                  type="button"
                  disabled={pending || acceptedCount === 0}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await applyProposal(proposal.id, [...accepted]);
                      if (!res.ok) {
                        setError(res.error ?? "No se ha podido aplicar.");
                        return;
                      }
                      setApplied({ id: proposal.id, count: res.applied ?? 0 });
                      setProposal(null);
                      setMessages((prev) => [
                        ...prev,
                        {
                          role: "assistant",
                          content: `${res.applied} ${res.applied === 1 ? "cambio aplicado" : "cambios aplicados"}. El motor de pesos sigue igual: las RM y la regla de regresión no se han tocado.`,
                        },
                      ]);
                      router.refresh();
                    })
                  }
                  className="flex h-[58px] flex-1 items-center justify-center bg-strength text-[14px] leading-none font-extrabold tracking-[0.06em] text-ink uppercase disabled:opacity-45"
                >
                  {acceptedCount === 0
                    ? "Nada seleccionado"
                    : `Aplicar ${acceptedCount} ${acceptedCount === 1 ? "cambio" : "cambios"}`}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await discardProposal(proposal.id);
                      setProposal(null);
                      setMessages((prev) => [
                        ...prev,
                        {
                          role: "assistant",
                          content: "Descartado. El plan queda como estaba.",
                        },
                      ]);
                    })
                  }
                  className="flex h-[58px] w-[110px] items-center justify-center bg-ink text-[12px] leading-none font-bold tracking-[0.06em] text-paper uppercase"
                >
                  Descartar
                </button>
              </div>
            ) : null}

            <div className="flex flex-none flex-col gap-2.5 border-t-2 border-ink px-4 pt-3 pb-3.5">
              {messages.length === 0 ? (
                <div className="flex flex-wrap gap-1">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={!hasApiKey || pending}
                      onClick={() => ask(s)}
                      className="border-2 border-ink px-2.5 py-2 text-left text-[10.5px] leading-[1.3] font-semibold disabled:opacity-40"
                    >
                      {s.length > 34 ? `${s.slice(0, 33)}…` : s}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="flex gap-0.5">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") ask(draft);
                  }}
                  disabled={!hasApiKey || pending}
                  placeholder="Dile qué quieres cambiar…"
                  aria-label="Mensaje para la IA"
                  className="h-11 min-w-0 flex-1 border-2 border-ink bg-paper px-3 text-[12.5px] font-medium outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  disabled={!hasApiKey || pending || !draft.trim()}
                  onClick={() => ask(draft)}
                  aria-label="Enviar"
                  className="flex h-11 w-[52px] items-center justify-center bg-ink text-[16px] leading-none font-bold text-paper disabled:opacity-40"
                >
                  →
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
