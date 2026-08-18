import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { resolvePostAuthPath } from "@/lib/auth/onboarding";
import {
  PASSWORD_RECOVERY_COOKIE,
  hasLegacyRecoveryParams,
  isPasswordRecoveryNext,
  safeAuthNextPath,
} from "@/lib/auth/recovery-params";

type CookieToSet = { name: string; value: string; options: CookieOptions };

function recoveryCookieOptions(origin: string): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https"),
    path: "/",
    maxAge: 60 * 15,
  };
}

function applyCookies(response: NextResponse, cookiesToSet: CookieToSet[]) {
  for (const { name, value, options } of cookiesToSet) {
    response.cookies.set(name, value, options);
  }
}

/**
 * Shared Auth callback for email confirmation + password recovery.
 * Signup confirmation: `/auth/callback?code=…` → session → /welcome|/scripts.
 * Recovery: `/auth/callback?code=…&next=/reset-password` → /reset-password.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const { searchParams, origin } = url;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  const safeNext = safeAuthNextPath(nextParam);
  const recoveryIntent = isPasswordRecoveryNext(safeNext ?? nextParam);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const authError =
    searchParams.get("error_description") ?? searchParams.get("error");

  if (authError) {
    const dest = recoveryIntent ? "/forgot-password" : "/login";
    return NextResponse.redirect(
      `${origin}${dest}?error=${encodeURIComponent(authError)}`,
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.redirect(`${origin}/login?error=auth_config`);
  }

  const cookiesToSet: CookieToSet[] = [];
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        for (const cookie of toSet) {
          cookiesToSet.push(cookie);
          request.cookies.set(cookie.name, cookie.value);
        }
      },
    },
  });

  let establishedRecovery =
    recoveryIntent ||
    Boolean(tokenHash && type === "recovery" && hasLegacyRecoveryParams(searchParams));

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const dest = recoveryIntent ? "/forgot-password" : "/login";
      const response = NextResponse.redirect(
        `${origin}${dest}?error=${encodeURIComponent(error.message)}`,
      );
      applyCookies(response, cookiesToSet);
      return response;
    }
  } else if (tokenHash && type === "recovery" && hasLegacyRecoveryParams(searchParams)) {
    const { error } = await supabase.auth.verifyOtp({
      type: "recovery",
      token_hash: tokenHash,
    });
    if (error) {
      const response = NextResponse.redirect(
        `${origin}/forgot-password?error=${encodeURIComponent(error.message)}`,
      );
      applyCookies(response, cookiesToSet);
      return response;
    }
    establishedRecovery = true;
  } else {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const dest = recoveryIntent ? "/forgot-password" : "/login";
    const response = NextResponse.redirect(`${origin}${dest}?error=session`);
    applyCookies(response, cookiesToSet);
    return response;
  }

  if (establishedRecovery) {
    const response = NextResponse.redirect(`${origin}/reset-password`);
    applyCookies(response, cookiesToSet);
    response.cookies.set(
      PASSWORD_RECOVERY_COOKIE,
      "1",
      recoveryCookieOptions(origin),
    );
    return response;
  }

  const postAuth = await resolvePostAuthPath(user.id);
  const response = NextResponse.redirect(`${origin}${postAuth}`);
  applyCookies(response, cookiesToSet);
  return response;
}
