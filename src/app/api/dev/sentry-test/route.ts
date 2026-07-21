import { notFound } from "next/navigation";

export async function GET() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SENTRY_TEST !== "1") {
    notFound();
  }
  throw new Error("PhaseShift Sentry test error — safe to ignore");
}
