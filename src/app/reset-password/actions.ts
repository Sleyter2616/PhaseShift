"use server";

import { cookies } from "next/headers";
import { PASSWORD_RECOVERY_COOKIE } from "@/lib/auth/recovery-params";

/** Clear the short-lived recovery marker after a successful password update. */
export async function clearPasswordRecoveryCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(PASSWORD_RECOVERY_COOKIE);
}
