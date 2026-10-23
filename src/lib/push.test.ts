import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const sendNotification = vi.fn();
vi.mock("web-push", () => ({ default: { sendNotification } }));
const createAdminClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createAdminClient }));

const { pushToAthlete } = await import("./push");

const message = { title: "Bloques", body: "hola", url: "/editor" };

function db(subs: unknown[]) {
  const del = vi.fn(() => ({ in: vi.fn().mockResolvedValue({}) }));
  createAdminClient.mockReturnValue({
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ data: subs, error: null }) }),
      delete: del,
    }),
  });
  return del;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "pub");
  vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
  vi.stubEnv("VAPID_SUBJECT", "mailto:a@b.c");
});

afterEach(() => {
  vi.unstubAllEnvs();
  sendNotification.mockReset();
  createAdminClient.mockReset();
});

describe("pushToAthlete", () => {
  it("does nothing without VAPID keys", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    await pushToAthlete("u1", message);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("sends the payload to every device of the athlete", async () => {
    db([
      { id: "1", endpoint: "https://e/1", p256dh: "k1", auth: "a1" },
      { id: "2", endpoint: "https://e/2", p256dh: "k2", auth: "a2" },
    ]);
    sendNotification.mockResolvedValue({});
    await pushToAthlete("u1", message);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(sendNotification.mock.calls[0][0]).toEqual({
      endpoint: "https://e/1",
      keys: { p256dh: "k1", auth: "a1" },
    });
    expect(sendNotification.mock.calls[0][1]).toBe(JSON.stringify(message));
  });

  it("drops a subscription the browser reports gone, and never throws", async () => {
    const del = db([{ id: "1", endpoint: "https://e/1", p256dh: "k", auth: "a" }]);
    sendNotification.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    await expect(pushToAthlete("u1", message)).resolves.toBeUndefined();
    expect(del).toHaveBeenCalled();
  });
});
