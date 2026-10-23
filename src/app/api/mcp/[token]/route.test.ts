import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const createAdminClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createAdminClient }));

const { GET, POST } = await import("./route");

const TOKEN = "s3cret-token";

function call(body: unknown, token = TOKEN) {
  return POST(
    new Request(`http://localhost/api/mcp/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  );
}

beforeEach(() => {
  vi.stubEnv("MCP_TOKEN", TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  createAdminClient.mockReset();
});

describe("/api/mcp/[token]", () => {
  it("does not exist for a wrong token, or without MCP_TOKEN", async () => {
    expect((await call({ jsonrpc: "2.0", id: 1, method: "ping" }, "nope")).status).toBe(404);
    vi.stubEnv("MCP_TOKEN", "");
    expect((await call({ jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(404);
  });

  it("initialize echoes a supported protocol version and hands over the brief", async () => {
    const res = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    const body = await res.json();
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.instructions).toContain("propose_changes");
  });

  it("answers an unknown protocol version with its own latest", async () => {
    const body = await (
      await call({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } })
    ).json();
    expect(body.result.protocolVersion).toBe("2025-11-25");
  });

  it("accepts notifications with a bare 202", async () => {
    const res = await call({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
  });

  it("lists the six tools, propose_changes the only write, with set_run in its ops", async () => {
    const body = await (await call({ jsonrpc: "2.0", id: 3, method: "tools/list" })).json();
    const tools = body.result.tools as Array<{
      name: string;
      inputSchema: { type: string; properties: Record<string, unknown> };
      annotations: { readOnlyHint: boolean };
    }>;
    expect(tools.map((t) => t.name)).toEqual([
      "list_athletes",
      "get_plan",
      "get_catalog",
      "get_sessions",
      "get_proposals",
      "propose_changes",
    ]);
    expect(tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name)).toEqual([
      "propose_changes",
    ]);
    for (const t of tools) expect(t.inputSchema.type).toBe("object");
    const propose = tools.find((t) => t.name === "propose_changes")!;
    expect(JSON.stringify(propose.inputSchema.properties.changes)).toContain("set_run");
  });

  it("returns invalid arguments as a tool error without touching the database", async () => {
    const body = await (
      await call({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "get_sessions", arguments: { athlete: "maria", from: "ayer" } },
      })
    ).json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("from");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("names unknown tools and methods as JSON-RPC errors", async () => {
    const tool = await (
      await call({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "drop_lifts" } })
    ).json();
    expect(tool.error.code).toBe(-32602);
    const method = await (await call({ jsonrpc: "2.0", id: 6, method: "resources/list" })).json();
    expect(method.error.code).toBe(-32601);
  });

  it("offers no SSE stream", async () => {
    const res = await GET(new Request(`http://localhost/api/mcp/${TOKEN}`), {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(res.status).toBe(405);
  });
});
