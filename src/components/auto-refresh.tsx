"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Never use meta refresh in App Router — it survives soft navigation.
// Same lesson class as the Phase 3.5 effect-cleanup rule: side effects
// that outlive the route must clean up on unmount.

interface AutoRefreshProps {
  intervalMs?: number;
}

export function AutoRefresh({ intervalMs = 2000 }: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return null;
}
