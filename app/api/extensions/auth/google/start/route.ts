import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isGoogleOAuthClientId } from "@/lib/google-oauth";
import { readExtensionSettings } from "@/lib/extensions/settings";

export const runtime = "nodejs";

/**
 * Mirrors the built-in Gmail flow but uses the extension's own client
 * credentials and redirect URI, so the calendar connection neither depends on
 * nor disturbs the Newsletters connection.
 */
export async function GET(request: NextRequest) {
  const settings = await readExtensionSettings();
  const { googleClientId, googleClientSecret } = settings.calendar;
  const failure = (error: string) =>
    NextResponse.redirect(
      new URL(`/?tab=calendar&error=${error}`, request.url),
    );

  if (!googleClientId || !googleClientSecret) return failure("oauth-config");
  if (!isGoogleOAuthClientId(googleClientId)) return failure("oauth-client-id");

  const state = randomBytes(24).toString("hex");
  const redirectUri = new URL(
    "/api/extensions/auth/google/callback",
    request.url,
  ).toString();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email https://www.googleapis.com/auth/calendar.readonly",
    access_type: "offline",
    prompt: "consent select_account",
    state,
  }).toString();

  const response = NextResponse.redirect(url);
  response.cookies.set("cc_calendar_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 600,
  });
  return response;
}
