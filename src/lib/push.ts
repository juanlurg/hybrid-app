import "server-only";

import webpush from "web-push";

import { createAdminClient } from "@/lib/supabase/server";

/**
 * Web Push to every device an athlete turned "Avisos del coach" on for.
 * Best-effort by design: a proposal is already saved when this runs, so
 * a dead endpoint or missing VAPID keys must never fail the tool call.
 *
 * Service-role client — the caller has already established `userId`.
 */

export interface PushMessage {
  title: string;
  body: string;
  /** Where a tap lands. */
  url: string;
}

export async function pushToAthlete(
  userId: string,
  message: PushMessage,
): Promise<void> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return;

  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    if (!data?.length) return;

    const payload = JSON.stringify(message);
    const gone: string[] = [];
    await Promise.all(
      data.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            {
              TTL: 60 * 60 * 24,
              timeout: 8000,
              vapidDetails: { subject, publicKey, privateKey },
            },
          );
        } catch (cause) {
          const status = (cause as { statusCode?: number }).statusCode;
          // 404/410: the browser dropped the subscription for good.
          if (status === 404 || status === 410) gone.push(sub.id);
          else console.error("[push] send failed", { status, cause });
        }
      }),
    );
    if (gone.length) {
      await db.from("push_subscriptions").delete().in("id", gone);
    }
  } catch (cause) {
    console.error("[push] failed", cause);
  }
}
