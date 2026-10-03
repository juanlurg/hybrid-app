"use client";

import { ArrowRight, Check, Sparkles, X } from "lucide-react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/kit";
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

/**
 * The AI as the last card of the editor, not a sheet over it: the diff it
 * proposes reads against the plantilla that is still on screen.
 */
export function AiPanel({
  hasApiKey,
  initialMessages,
  initialThreadId,
  initialProposal,
  lastApplied,
  appliedTotal,
}: {
  hasApiKey: boolean;
  initialMessages: ThreadMessage[];
  initialThreadId: string | null;
  initialProposal: ProposalView | null;
  lastApplied: { id: string; count: number } | null;
  appliedTotal: number;
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
  const hasThread =
    !hasApiKey ||
    messages.length > 0 ||
    thinking ||
    error != null ||
    proposal != null ||
    applied != null;

  return (
    <Card className="rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden size={16} className="flex-none text-clay" />
        <span className="min-w-0 flex-1 text-[11px] leading-none font-bold tracking-[0.13em] text-clay uppercase">
          Refinar con IA
        </span>
        {appliedTotal > 0 ? (
          <span className="num flex-none text-[12px] leading-none font-semibold text-mid">
            {appliedTotal} {appliedTotal === 1 ? "aplicado" : "aplicados"}
          </span>
        ) : null}
      </div>

      {hasThread ? (
        <div className="mt-3.5 flex flex-col gap-3">
          {!hasApiKey ? (
            <div className="rounded-xl bg-warn-soft px-4 py-3 text-[13px] leading-[1.5] font-medium text-clay-dim">
              Falta <code className="font-bold">GEMINI_API_KEY</code> en{" "}
              <code className="font-bold">.env.local</code>. Consíguela en
              aistudio.google.com/apikey, añádela y reinicia el servidor. El
              resto del editor funciona sin ella.
            </div>
          ) : null}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[86%] rounded-xl rounded-br-sm bg-soft px-3.5 py-2.5 text-[13.5px] leading-[1.45] font-medium">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex items-start gap-2.5">
                <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-clay-soft text-clay">
                  <Sparkles aria-hidden size={14} />
                </span>
                <p className="mt-0.5 min-w-0 flex-1 text-[13.5px] leading-[1.5] font-medium text-body">
                  {m.content}
                </p>
              </div>
            ),
          )}

          {thinking ? (
            <div className="flex items-center gap-2 text-mid">
              <span className="animate-pulse-block h-2.5 w-2.5 rounded-sm bg-strength" />
              <span className="text-[12.5px] leading-none font-semibold">
                Leyendo tu plan…
              </span>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl bg-fail-soft px-4 py-3 text-[13px] leading-[1.45] font-medium text-fail">
              {error}
            </div>
          ) : null}

          {proposal &&
          (proposal.changes.length > 0 || proposal.dropped.length > 0) ? (
            <>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="flex-1 text-[14px] leading-none font-extrabold">
                  Cambios propuestos
                </span>
                <span className="num text-[12px] leading-none font-semibold text-mid">
                  {acceptedCount} de {proposal.changes.length} aceptados
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {proposal.changes.map((c, i) => {
                  const on = accepted.has(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setAccepted((prev) => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          return next;
                        })
                      }
                      className={cn(
                        "flex gap-2.5 rounded-xl p-3 text-left",
                        on ? "bg-sunk" : "ring-1 ring-edge ring-inset",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[5px]",
                          on
                            ? "bg-strength text-on-strength"
                            : "bg-soft text-transparent",
                        )}
                      >
                        <Check aria-hidden size={14} strokeWidth={3} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block text-[13.5px] leading-[1.35] font-bold",
                            !on && "text-mid",
                          )}
                        >
                          {c.title}
                        </span>
                        <span className="num mt-1 flex flex-wrap items-center gap-1.5 text-[12px] leading-[1.3] font-semibold">
                          <span className="text-faint line-through">
                            {c.from || "—"}
                          </span>
                          <ArrowRight
                            aria-hidden
                            size={12}
                            className="flex-none text-faint"
                          />
                          <span className="font-bold">{c.to || "—"}</span>
                        </span>
                        {c.why ? (
                          <span className="mt-1.5 block text-[12.5px] leading-[1.45] font-medium text-mid">
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
                    className="flex gap-2.5 rounded-xl p-3 ring-1 ring-edge ring-inset"
                  >
                    <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-[5px] bg-soft text-faint">
                      <X aria-hidden size={14} strokeWidth={3} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] leading-[1.35] font-semibold text-faint line-through">
                        {d.op.title}
                      </span>
                      <span className="mt-1.5 block text-[12.5px] leading-[1.45] font-medium text-mid">
                        Las reglas lo dejan fuera: {d.reason}.
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {proposal && proposal.changes.length > 0 ? (
            <div className="flex gap-2">
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
                className="flex h-12 flex-1 items-center justify-center rounded-2xl bg-strength text-[14.5px] leading-none font-bold text-on-strength disabled:opacity-45"
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
                className="flex h-12 w-[100px] flex-none items-center justify-center rounded-2xl bg-soft text-[14px] leading-none font-bold text-body"
              >
                Descartar
              </button>
            </div>
          ) : null}

          {applied ? (
            <div className="flex items-center gap-2.5 rounded-xl bg-ok-soft px-3.5 py-3">
              <Check
                aria-hidden
                size={16}
                strokeWidth={2.5}
                className="flex-none text-ok"
              />
              <span className="min-w-0 flex-1 text-[13.5px] leading-[1.3] font-bold text-ok">
                {applied.count}{" "}
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
                className="-my-2 flex h-9 flex-none items-center text-[13px] leading-none font-bold text-clay disabled:opacity-40"
              >
                Deshacer
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {messages.length === 0 && !thinking ? (
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={!hasApiKey || pending}
              onClick={() => ask(s)}
              className="rounded-full bg-soft px-3 py-2 text-left text-[12px] leading-[1.3] font-semibold disabled:opacity-40"
            >
              {s.length > 34 ? `${s.slice(0, 33)}…` : s}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-3.5 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") ask(draft);
          }}
          disabled={!hasApiKey || pending}
          placeholder="p. ej. «cambia el remo por dominadas asistidas»…"
          aria-label="Mensaje para la IA"
          className="h-[46px] min-w-0 flex-1 rounded-2xl bg-soft px-3.5 text-[13.5px] leading-none font-medium text-ink outline-none placeholder:text-mid disabled:opacity-50"
        />
        <button
          type="button"
          disabled={!hasApiKey || pending || !draft.trim()}
          onClick={() => ask(draft)}
          className="flex h-[46px] flex-none items-center rounded-2xl bg-panel px-3.5 text-[13.5px] leading-none font-bold text-on-panel disabled:opacity-40"
        >
          Proponer
        </button>
      </div>
      <p className="mt-2.5 text-[12px] leading-[1.45] font-medium text-mid">
        La IA propone un diff; tú marcas qué aplicar. Nunca toca tus RM.
      </p>
    </Card>
  );
}
