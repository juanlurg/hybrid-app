"use server";

import { createAdminClient, getUser } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string };

export interface PushSubscriptionJson {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Register this device for the coach's push. Admin client because the
 * endpoint is unique per browser: if another athlete used this phone
 * before, the row moves to whoever is signed in now, which RLS would not
 * allow an upsert to do.
 */
export async function savePushSubscription(
  sub: PushSubscriptionJson,
): Promise<Result> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Sin sesión iniciada." };

  const { error } = await createAdminClient()
    .from("push_subscriptions")
    .upsert({ ...sub, user_id: user.id }, { onConflict: "endpoint" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<Result> {
  const user = await getUser();
  if (!user) return { ok: false, error: "Sin sesión iniciada." };

  const { error } = await createAdminClient()
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
