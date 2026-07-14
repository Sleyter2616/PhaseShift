import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth/session";
import { createCheckoutSession } from "@/lib/billing/checkout";

const bodySchema = z.object({
  kind: z.enum(["topup", "subscribe"]),
  tier: z.enum(["guided", "practitioner"]).optional(),
});

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireSessionUser();
    const parsed = bodySchema.parse(await request.json());

    if (parsed.kind === "subscribe" && !parsed.tier) {
      return NextResponse.json({ error: "tier is required for subscribe" }, { status: 400 });
    }

    const url = await createCheckoutSession({
      supabase,
      user,
      kind: parsed.kind,
      tier: parsed.tier,
    });

    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "checkout failed";
    if (message === "unauthorized") {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
