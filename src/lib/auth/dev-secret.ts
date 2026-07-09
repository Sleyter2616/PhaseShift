import { NextResponse } from "next/server";

export function assertDevAuth(request: Request): string {
  const secret = request.headers.get("x-dev-secret");
  if (!secret || secret !== process.env.DEV_API_SECRET) {
    throw new DevAuthError();
  }

  const userId = process.env.DEV_USER_ID;
  if (!userId) {
    throw new Error("DEV_USER_ID is not configured");
  }

  return userId;
}

export class DevAuthError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "DevAuthError";
  }
}

export function devAuthErrorResponse(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
