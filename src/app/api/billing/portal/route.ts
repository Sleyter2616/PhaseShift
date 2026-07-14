import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/session";
import { createBillingPortalSession } from "@/lib/billing/checkout";

export async function POST() {
  try {
    const { supabase, user } = await requireSessionUser();
    const url = await createBillingPortalSession(supabase, user);
    return NextResponse.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "portal failed";
    if (message === "unauthorized") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
