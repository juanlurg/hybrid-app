import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { MCP_INSTRUCTIONS } from "@/lib/ai/prompt";
import { MCP_TOOLS, ToolError } from "@/lib/mcp/tools";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The coach as a remote MCP server, for a Claude chat added as a custom
 * connector. Streamable HTTP in its stateless form: one JSON-RPC message
 * per POST, a JSON answer, no SSE stream and no session id — tools are
 * all this server offers.
 *
 * The secret is the path segment (`/api/mcp/<MCP_TOKEN>`), because a
 * connector URL is all the auth a two-athlete app needs. Without
 * MCP_TOKEN set, the route does not exist.
 */

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const messageSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).nullish(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

function authorised(token: string): boolean {
  const expected = process.env.MCP_TOKEN;
  if (!expected) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(token), digest(expected));
}

type Id = string | number | null;

const result = (id: Id, value: unknown) =>
  NextResponse.json({ jsonrpc: "2.0", id, result: value });

const failure = (id: Id, code: number, message: string, status = 200) =>
  NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status },
  );

const toolList = () =>
  MCP_TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: z.toJSONSchema(t.input, { io: "input" }),
    annotations: {
      readOnlyHint: t.readOnly,
      destructiveHint: false,
      openWorldHint: false,
    },
  }));

async function callTool(params: Record<string, unknown> | undefined) {
  const tool = MCP_TOOLS.find((t) => t.name === params?.name);
  if (!tool) return null;
  const text = (value: string, isError = false) => ({
    content: [{ type: "text", text: value }],
    isError,
  });

  const args = tool.input.safeParse(params?.arguments ?? {});
  if (!args.success) {
    return text(
      `Argumentos inválidos: ${args.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      true,
    );
  }
  try {
    return text(await tool.run(args.data as never, createAdminClient()));
  } catch (cause) {
    if (cause instanceof ToolError) return text(cause.message, true);
    console.error("[mcp] tool failed", { tool: tool.name, cause });
    return text(
      `Error inesperado: ${cause instanceof Error ? cause.message : "desconocido"}`,
      true,
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!authorised(token)) return new Response(null, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure(null, -32700, "Parse error", 400);
  }
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) return failure(null, -32600, "Invalid Request", 400);
  const { id, method, params: rpcParams } = parsed.data;

  // Notifications and the client's own responses get no answer.
  if (id == null || method == null) return new Response(null, { status: 202 });

  switch (method) {
    case "initialize": {
      const asked = rpcParams?.protocolVersion;
      return result(id, {
        protocolVersion:
          typeof asked === "string" && PROTOCOL_VERSIONS.includes(asked)
            ? asked
            : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "bloques", title: "Bloques", version: "1.0.0" },
        instructions: MCP_INSTRUCTIONS,
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: toolList() });
    case "tools/call": {
      const called = await callTool(rpcParams);
      return called
        ? result(id, called)
        : failure(id, -32602, `Unknown tool: ${String(rpcParams?.name)}`);
    }
    default:
      return failure(id, -32601, `Method not found: ${method}`);
  }
}

/** No server-initiated stream: the spec's answer is 405. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!authorised(token)) return new Response(null, { status: 404 });
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
