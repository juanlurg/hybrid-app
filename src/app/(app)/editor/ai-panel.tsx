"use client";

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
    <Card className="px-4 py-4">
      <div className="flex items-center gap-2">
        <span className="font-display min-w-0 flex-1 text-[11px] leading-none font-semibold tracking-[0.14em] text-lime uppercase">
          Refinar con IA
        </span>
        {appliedTotal > 0 ? (
          <span className="num flex-none text-[11px] leading-none text-faint">
            {appliedTotal} {appliedTotal === 1 ? "aplicado" : "aplicados"}
          </span>
        ) : null}
      </div>

      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") ask(draft);
        }}
        disabled={!hasApiKey || pending}
        placeholder="p. ej. «cambia el remo por dominadas asistidas»…"
        aria-label="Mensaje para la IA"
        className="mt-2.5 min-h-11 w-full rounded-md border border-edge bg-bg px-3.5 py-3 text-[13px] leading-[1.3] text-ink outline-none disabled:opacity-50"
      />

      <div className="mt-2.5 flex items-center gap-3">
        <p className="min-w-0 flex-1 text-[11.5px] leading-[1.45] text-faint">
          La IA propone un diff; tú marcas qué aplicar. Nunca toca tus RM.
        </p>
        {/* 44px rather than the mock's 40px: still a tap target. */}
        <button
          type="button"
          disabled={!hasApiKey || pending || !draft.trim()}
          onClick={() => ask(draft)}
          className="font-display flex h-11 flex-none items-center rounded-md bg-strength px-[18px] text-[12.5px] leading-none font-bold text-on-strength uppercase disabled:opacity-40"
        >
          Proponer
        </button>
      </div>

      {messages.length === 0 && !thinking ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={!hasApiKey || pending}
              onClick={() => ask(s)}
              className="rounded-sm border border-edge bg-soft px-2.5 py-2 text-left text-[11px] leading-[1.3] font-medium disabled:opacity-40"
            >
              {s.length > 34 ? `${s.slice(0, 33)}…` : s}
            </button>
          ))}
        </div>
      ) : null}

      {hasThread ? (
        <div className="mt-3.5 flex flex-col gap-2.5 border-t border-line pt-3.5">
          {!hasApiKey ? (
            <div className="rounded-r-sm border-l-[4px] border-warn py-1 pl-3 text-[12.5px] leading-[1.55]">
              Falta <code className="font-bold">GEMINI_API_KEY</code> en{" "}
              <code className="font-bold">.env.local</code>. Consíguela en
              aistudio.google.com/apikey, añádela y reinicia el servidor. El
              resto del editor funciona sin ella.
            </div>
          ) : null}

          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[88%]",
                m.role === "user"
                  ? "self-end rounded-lg border border-edge bg-soft px-3.5 py-2.5 text-[12.5px] leading-[1.45]"
                  : "self-start rounded-r-sm border-l-[3px] border-lime-line py-0.5 pl-3.5 text-[12.5px] leading-[1.55]",
              )}
            >
              {m.content}
            </div>
          ))}

          {thinking ? (
            <div className="flex items-center gap-2 text-mid">
              <span className="animate-pulse-block h-2.5 w-2.5 rounded-sm bg-strength" />
              <span className="font-display text-[11px] leading-none font-semibold tracking-[0.06em] uppercase">
                Leyendo tu plan…
              </span>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-r-sm border-l-[4px] border-fail py-1 pl-3 text-[12.5px] leading-[1.5]">
              {error}
            </div>
          ) : null}

          {proposal &&
          (proposal.changes.length > 0 || proposal.dropped.length > 0) ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-[11px] leading-none font-semibold tracking-[0.14em] text-mid uppercase">
                  Cambios propuestos
                </span>
                <span className="num ml-auto text-[11px] leading-none text-faint">
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
                      "flex gap-2.5 rounded-lg border px-3 py-2.5 text-left",
                      on
                        ? "border-lime-edge bg-lime-soft"
                        : "border-line bg-soft",
                    )}
                  >
                    <span
                      className={cn(
                        "font-display flex h-5 w-5 flex-none items-center justify-center rounded-[5px] text-[11px] leading-none font-semibold",
                        on
                          ? "bg-strength text-on-strength"
                          : "border border-edge bg-surface",
                      )}
                    >
                      {on ? "✓" : ""}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-[1.3] font-medium">
                        {c.title}
                      </span>
                      <span className="font-display mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] leading-[1.3]">
                        <span className="text-faint line-through">
                          {c.from || "—"}
                        </span>
                        <span className="text-faint">→</span>
                        <span className="font-semibold">{c.to || "—"}</span>
                      </span>
                      {c.why ? (
                        <span className="mt-2 block text-[12px] leading-[1.45] text-mid">
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
                  className="flex gap-2.5 rounded-lg border border-dashed border-hairline px-3 py-2.5"
                >
                  <span className="font-display flex h-5 w-5 flex-none items-center justify-center rounded-[5px] border border-hairline text-[11px] leading-none font-semibold text-ghost">
                    ×
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] leading-[1.3] font-medium text-ghost line-through">
                      {d.op.title}
                    </span>
                    <span className="mt-1.5 block text-[12px] leading-[1.45] text-mid">
                      Las reglas lo dejan fuera: {d.reason}.
                    </span>
                  </span>
                </div>
              ))}
            </>
          ) : null}

          {proposal && proposal.changes.length > 0 ? (
            <div className="flex gap-1.5">
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
                className="font-display flex h-11 flex-1 items-center justify-center rounded-md bg-strength text-[12.5px] leading-none font-bold tracking-[0.06em] text-on-strength uppercase disabled:opacity-45"
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
                className="font-display flex h-11 w-[104px] flex-none items-center justify-center rounded-md border border-edge bg-soft text-[11.5px] leading-none font-semibold tracking-[0.06em] text-mid uppercase"
              >
                Descartar
              </button>
            </div>
          ) : null}

          {applied ? (
            <div className="flex items-center gap-2.5 rounded-lg border border-line bg-soft px-3 py-2.5">
              <span className="font-display min-w-0 flex-1 text-[11px] leading-none font-semibold tracking-[0.06em] text-lime-dim uppercase">
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
                className="flex-none text-[11px] leading-none font-medium text-mid underline"
              >
                deshacer
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
