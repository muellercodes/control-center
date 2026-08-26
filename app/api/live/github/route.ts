import { getDatabase } from "@/lib/server/database";
import { readExtensionSettings } from "@/lib/extensions/settings";
import { collectGithub, githubScope } from "@/lib/server/extensions/github";
import {
  readExtensionSnapshot,
  writeExtensionSnapshot,
} from "@/lib/extensions/store";
import type { GithubFeedResponse } from "@/lib/extensions/types";

export const runtime = "nodejs";

const EXTENSION = "github";

export async function GET(request: Request) {
  const settings = await readExtensionSettings();
  const scope = githubScope(settings);
  const forceRefresh =
    new URL(request.url).searchParams.get("refresh") === "1";
  const database = getDatabase();

  if (!forceRefresh) {
    const cached = readExtensionSnapshot<GithubFeedResponse>(
      database,
      EXTENSION,
      scope,
    );
    // Serve the last snapshot so switching tabs never re-spends API quota.
    if (cached) return Response.json({ ...cached.payload, cached: true });
  }

  if (!settings.github.login)
    return Response.json({
      configured: false,
      checkedAt: new Date().toISOString(),
      items: [],
      errors: [],
    } satisfies GithubFeedResponse);

  const payload = await collectGithub(settings);
  // Keep the previous good snapshot when a refresh comes back entirely empty
  // because of errors, rather than blanking the tab on a transient failure.
  const failedOutright = payload.errors.length && !payload.items.length;
  if (!failedOutright) writeExtensionSnapshot(database, EXTENSION, scope, payload);
  return Response.json(payload);
}
